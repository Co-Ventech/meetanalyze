import { useState, useEffect, useCallback } from 'react';
import { getGoogleMeetTab } from '../../utils/check-google-meet-connection';
import type { TranscriptTurn, PartialTranscriptState } from '../../common/types';

declare const chrome: any;

export interface UseRealtimeTranscriptionOptions {
  apiBaseUrl?: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
}

function normalizeTurns(items: any[]): TranscriptTurn[] {
  if (!Array.isArray(items)) return [];
  return items.map((item, idx) => {
    if (typeof item === 'string') {
      return {
        id: `legacy_${idx}`,
        speaker: 'Participant',
        isSelf: false,
        text: item,
        timestamp: '',
      };
    }
    return item;
  });
}

function normalizePartial(partial: any): PartialTranscriptState | null {
  if (!partial) return null;
  if (typeof partial === 'string') {
    return partial.trim() ? { speaker: 'Speaker', isSelf: false, text: partial } : null;
  }
  if (typeof partial === 'object' && partial.text?.trim()) {
    return partial;
  }
  return null;
}

export function useRealtimeTranscription({
  apiBaseUrl = 'http://localhost:5000',
  onTranscript,
  onError,
}: UseRealtimeTranscriptionOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTabAudioCaptured, setIsTabAudioCaptured] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState<PartialTranscriptState | null>(null);
  const [finalTranscripts, setFinalTranscripts] = useState<TranscriptTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPermissionRequired, setIsPermissionRequired] = useState(false);

  // Sync state from chrome.storage and active background/offscreen recorder on mount
  useEffect(() => {
    let isMounted = true;

    // 1. Read persisted state from chrome.storage.local
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.get(
        ['isRecording', 'isTabAudioCaptured', 'partialTranscript', 'finalTranscripts'],
        (stored: any) => {
          if (!isMounted || !stored) return;
          if (typeof stored.isRecording === 'boolean') {
            setIsRecording(stored.isRecording);
          }
          if (typeof stored.isTabAudioCaptured === 'boolean') {
            setIsTabAudioCaptured(stored.isTabAudioCaptured);
          }
          setPartialTranscript(normalizePartial(stored.partialTranscript));
          if (Array.isArray(stored.finalTranscripts)) {
            setFinalTranscripts(normalizeTurns(stored.finalTranscripts));
          }
        }
      );
    }

    // 2. Query active offscreen state
    try {
      chrome.runtime?.sendMessage?.({ type: 'GET_RECORDING_STATE' }, (response: any) => {
        if (!isMounted || !response) return;
        if (typeof response.isRecording === 'boolean') {
          setIsRecording(response.isRecording);
        }
        if (typeof response.isTabAudioCaptured === 'boolean') {
          setIsTabAudioCaptured(response.isTabAudioCaptured);
        }
        setPartialTranscript(normalizePartial(response.partialTranscript));
        if (Array.isArray(response.finalTranscripts)) {
          setFinalTranscripts(normalizeTurns(response.finalTranscripts));
        }
      });
    } catch (err) {
      console.warn('[MeetAnalyze] Could not query initial recording state:', err);
    }

    // 3. Listen to live events broadcast from offscreen document
    const messageListener = (message: any) => {
      if (!isMounted || !message) return;

      if (message.type === 'RECORDING_STARTED') {
        setIsRecording(true);
        setIsConnecting(false);
        setIsTabAudioCaptured(!!message.isTabAudioCaptured);
      } else if (message.type === 'TRANSCRIPT_UPDATE') {
        const normPartial = normalizePartial(message.partialTranscript);
        setPartialTranscript(normPartial);

        if (Array.isArray(message.finalTranscripts)) {
          setFinalTranscripts(normalizeTurns(message.finalTranscripts));
        }
        if (onTranscript && (normPartial?.text || message.isFinal)) {
          onTranscript(normPartial?.text || '', !!message.isFinal);
        }
      } else if (message.type === 'RECORDING_STOPPED') {
        setIsRecording(false);
        setIsConnecting(false);
        setIsTabAudioCaptured(false);
        setPartialTranscript(null);
        if (Array.isArray(message.finalTranscripts)) {
          setFinalTranscripts(normalizeTurns(message.finalTranscripts));
        }
      } else if (message.type === 'RECORDING_ERROR') {
        setIsRecording(false);
        setIsConnecting(false);
        setError(message.error || 'Recording error occurred in background');
      }
    };

    chrome.runtime?.onMessage?.addListener(messageListener);

    return () => {
      isMounted = false;
      chrome.runtime?.onMessage?.removeListener?.(messageListener);
    };
  }, [onTranscript]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setIsPermissionRequired(false);
      setIsConnecting(true);

      // 1. Check microphone permission in foreground
      try {
        const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately release test stream
        testStream.getTracks().forEach((t) => t.stop());
      } catch (micErr: unknown) {
        const err = micErr as { name?: string; message?: string };
        if (
          err.name === 'NotAllowedError' ||
          err.name === 'PermissionDeniedError' ||
          err.name === 'PermissionDismissedError' ||
          err.message?.toLowerCase().includes('dismissed') ||
          err.message?.toLowerCase().includes('permission')
        ) {
          setIsPermissionRequired(true);
          setIsConnecting(false);
          throw new Error('Microphone permission required. Please grant permission once in the permission tab.');
        }
      }

      // 2. Fetch short-lived token from backend
      const tokenRes = await fetch(`${apiBaseUrl}/api/v1/transcription/token`);
      if (!tokenRes.ok) {
        throw new Error(`Failed to fetch streaming token from backend (HTTP ${tokenRes.status})`);
      }
      const { token } = await tokenRes.json();
      if (!token) {
        throw new Error('No token returned from backend server.');
      }

      // 3. Acquire Google Meet Tab Media Stream ID
      let streamId: string | undefined;
      const meetTab = await getGoogleMeetTab();
      if (meetTab?.id && chrome.tabCapture?.getMediaStreamId) {
        try {
          streamId = await new Promise<string>((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId({ targetTabId: meetTab.id }, (id: string | null) => {
              if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
              }
              if (!id) {
                return reject(new Error('Failed to acquire tab media stream ID'));
              }
              resolve(id);
            });
          });
          setIsTabAudioCaptured(true);
        } catch (tabErr) {
          console.warn('[MeetAnalyze] Tab media stream ID acquisition failed:', tabErr);
          setIsTabAudioCaptured(false);
        }
      }

      // 4. Send command to background to start persistent offscreen recording with speaker tracking
      chrome.runtime.sendMessage(
        {
          type: 'START_RECORDING',
          streamId,
          token,
          targetTabId: meetTab?.id,
        },
        (res: any) => {
          setIsConnecting(false);
          if (res && res.success === false) {
            setError(res.error || 'Failed to start background recording');
            setIsRecording(false);
          } else {
            setIsRecording(true);
          }
        }
      );
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error('Failed to start recording:', e);
      setError(e.message);
      setIsConnecting(false);
      setIsRecording(false);
      onError?.(e);
    }
  }, [apiBaseUrl, onError]);

  const stopRecording = useCallback(() => {
    setIsConnecting(false);
    setIsRecording(false);
    setPartialTranscript(null);

    try {
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    } catch (err) {
      console.warn('[MeetAnalyze] Failed to send STOP_RECORDING:', err);
    }
  }, []);

  const clearTranscripts = useCallback(() => {
    setFinalTranscripts([]);
    setPartialTranscript(null);
    chrome.storage?.local?.set?.({
      finalTranscripts: [],
      partialTranscript: '',
    });
    try {
      chrome.runtime?.sendMessage?.({ type: 'CLEAR_TRANSCRIPTS' });
    } catch (err) {
      console.warn('[MeetAnalyze] Failed to broadcast CLEAR_TRANSCRIPTS:', err);
    }
  }, []);

  return {
    isRecording,
    isConnecting,
    isTabAudioCaptured,
    isPermissionRequired,
    partialTranscript,
    finalTranscripts,
    error,
    startRecording,
    stopRecording,
    clearTranscripts,
  };
}
