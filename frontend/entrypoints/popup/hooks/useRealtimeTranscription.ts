import { useState, useEffect, useCallback } from 'react';
import { getGoogleMeetTab } from '../../utils/check-google-meet-connection';
import type { TranscriptTurn, PartialTranscriptState, SpeakerInfo } from '../../common/types';

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
  const [speakerInfo, setSpeakerInfo] = useState<SpeakerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPermissionRequired, setIsPermissionRequired] = useState(false);

  // Sync state from chrome.storage and active background/offscreen recorder on mount
  useEffect(() => {
    let isMounted = true;

    // 1. Read persisted state from chrome.storage.local
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.get(
        ['isRecording', 'isTabAudioCaptured', 'partialTranscript', 'finalTranscripts', 'speakerInfo'],
        (stored: any) => {
          if (!isMounted || !stored) return;
          if (typeof stored.isRecording === 'boolean') {
            setIsRecording(stored.isRecording);
          }
          if (typeof stored.isTabAudioCaptured === 'boolean') {
            setIsTabAudioCaptured(stored.isTabAudioCaptured);
          }
          if (stored.speakerInfo) {
            setSpeakerInfo(stored.speakerInfo);
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
        if (response.speakerInfo) {
          setSpeakerInfo(response.speakerInfo);
        }
        setPartialTranscript(normalizePartial(response.partialTranscript));
        if (Array.isArray(response.finalTranscripts)) {
          setFinalTranscripts(normalizeTurns(response.finalTranscripts));
        }
      });
    } catch (err) {
      console.warn('[MeetAnalyze] Could not query initial recording state:', err);
    }

    // 3. Listen to live events broadcast from offscreen and background
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
      } else if (message.type === 'TRANSCRIPTS_RELABELED') {
        if (Array.isArray(message.finalTranscripts)) {
          setFinalTranscripts(normalizeTurns(message.finalTranscripts));
        }
      } else if (message.type === 'SPEAKER_INFO_DISPATCH' || message.type === 'SPEAKER_INFO_UPDATED') {
        if (message.speakerInfo) {
          setSpeakerInfo(message.speakerInfo);
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

      // 2. Fetch short-lived tokens from backend.
      // Mic and Meet-tab audio are transcribed as two separate AssemblyAI sessions
      // (one token per session) so "me vs others" never has to be guessed.
      const fetchToken = async (): Promise<{ token: string; host: string }> => {
        const tokenRes = await fetch(`${apiBaseUrl}/api/v1/transcription/token`);
        if (!tokenRes.ok) {
          let errMessage = `Failed to fetch streaming token from backend (HTTP ${tokenRes.status})`;
          try {
            const errData = await tokenRes.json();
            if (errData?.message) errMessage = errData.message;
          } catch {}
          throw new Error(errMessage);
        }
        const data = await tokenRes.json();
        if (!data?.token) {
          throw new Error('No token returned from backend server.');
        }
        return { token: data.token, host: data.host || 'streaming.assemblyai.com' };
      };
      const [micAuth, tabAuth] = await Promise.all([fetchToken(), fetchToken().catch(() => null)]);
      const host = micAuth.host;

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
          micToken: micAuth.token,
          tabToken: tabAuth?.token,
          host,
          targetTabId: meetTab?.id,
        },
        (res: any) => {
          if (!res?.success) {
            setError(res?.error || 'Failed to start background transcription');
            setIsConnecting(false);
          }
        }
      );
    } catch (err: unknown) {
      const e = err as Error;
      setIsConnecting(false);
      setError(e.message || 'Unknown error occurred while starting transcription');
      if (onError) onError(e);
    }
  }, [apiBaseUrl, onError]);

  const stopRecording = useCallback(() => {
    chrome.runtime?.sendMessage?.({ type: 'STOP_RECORDING' });
  }, []);

  const clearTranscripts = useCallback(() => {
    setFinalTranscripts([]);
    setPartialTranscript(null);
    chrome.runtime?.sendMessage?.({ type: 'CLEAR_TRANSCRIPTS' });
  }, []);

  const setGuestName = useCallback((name: string, originalName?: string) => {
    chrome.runtime?.sendMessage?.({ type: 'SET_GUEST_NAME', name, originalName });
  }, []);

  const relabelFromMeet = useCallback(async (): Promise<{ status: string; changed?: number; reason?: string }> => {
    return new Promise((resolve) => {
      chrome.runtime?.sendMessage?.({ type: 'RELABEL_FROM_MEET' }, (res: any) => {
        if (chrome.runtime?.lastError || !res) {
          resolve({ status: 'unavailable', reason: chrome.runtime?.lastError?.message || 'No response' });
          return;
        }
        resolve(res);
      });
    });
  }, []);

  return {
    isRecording,
    isConnecting,
    isTabAudioCaptured,
    isPermissionRequired,
    partialTranscript,
    finalTranscripts,
    speakerInfo,
    error,
    startRecording,
    stopRecording,
    clearTranscripts,
    setGuestName,
    relabelFromMeet,
  };
}
