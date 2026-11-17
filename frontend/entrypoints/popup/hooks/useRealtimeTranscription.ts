import { useState, useEffect, useCallback } from 'react';
import { getGoogleMeetTab } from '../../utils/check-google-meet-connection';
import type { CaptureMeta, PartialTranscriptState, TranscriptTurn } from '../../common/types';

const STORAGE_KEYS = ['isRecording', 'captionsOn', 'partialTranscript', 'finalTranscripts', 'captureMeta', 'captureError'];

/**
 * Popup / side-panel view of the caption capture running in the Google Meet tab.
 * All state lives in chrome.storage.local (written by the content script); this hook mirrors it
 * and sends start/stop commands to the Meet tab.
 */
export function useRealtimeTranscription() {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState<PartialTranscriptState | null>(null);
  const [finalTranscripts, setFinalTranscripts] = useState<TranscriptTurn[]>([]);
  const [captureMeta, setCaptureMeta] = useState<CaptureMeta | null>(null);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const apply = (values: Record<string, any>) => {
      if (!mounted) return;
      if ('isRecording' in values) {
        setIsRecording(!!values.isRecording);
        if (values.isRecording) setIsConnecting(false);
      }
      if ('captionsOn' in values) setCaptionsOn(!!values.captionsOn);
      if ('partialTranscript' in values) {
        const p = values.partialTranscript;
        setPartialTranscript(p && typeof p === 'object' && p.text?.trim() ? p : null);
      }
      if ('finalTranscripts' in values) {
        setFinalTranscripts(Array.isArray(values.finalTranscripts) ? values.finalTranscripts : []);
      }
      if ('captureMeta' in values) setCaptureMeta(values.captureMeta ?? null);
      if ('captureError' in values) setCaptureNotice(values.captureError ?? null);
    };

    browser.storage.local.get(STORAGE_KEYS).then(apply).catch(() => {});

    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'local') return;
      const values: Record<string, unknown> = {};
      for (const key of STORAGE_KEYS) if (key in changes) values[key] = changes[key]!.newValue;
      if (Object.keys(values).length) apply(values);
    };
    browser.storage.onChanged.addListener(onChanged);

    return () => {
      mounted = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const sendToMeetTab = useCallback(async (message: Record<string, unknown>) => {
    const tab = await getGoogleMeetTab();
    if (!tab?.id) throw new Error('Open your Google Meet call in a tab first.');
    try {
      return await browser.tabs.sendMessage(tab.id, message);
    } catch {
      throw new Error('Could not reach the Google Meet tab. Reload the Meet tab and try again.');
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setIsConnecting(true);
    try {
      const tab = await getGoogleMeetTab();
      const url = tab?.url || '';
      const meetCode = url.match(/meet\.google\.com\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})/i)?.[1] || '';
      // Start a fresh transcript when this is a different meeting from the one already captured
      const reset = !captureMeta || captureMeta.meetCode !== meetCode;
      const res: any = await sendToMeetTab({ type: 'START_CAPTURE', reset });
      if (!res?.success) throw new Error('Google Meet tab did not start caption capture.');
    } catch (e: any) {
      setError(e?.message || 'Failed to start caption capture');
    } finally {
      setIsConnecting(false);
    }
  }, [captureMeta, sendToMeetTab]);

  const stopRecording = useCallback(async () => {
    try {
      await sendToMeetTab({ type: 'STOP_CAPTURE' });
    } catch {
      // Meet tab is gone: just mark capture stopped
      await browser.storage.local.set({ isRecording: false, partialTranscript: null, captionsOn: false });
    }
  }, [sendToMeetTab]);

  const clearTranscripts = useCallback(async () => {
    setFinalTranscripts([]);
    setPartialTranscript(null);
    await browser.storage.local.set({ finalTranscripts: [], partialTranscript: null, captureMeta: null });
  }, []);

  return {
    isRecording,
    isConnecting,
    captionsOn,
    partialTranscript,
    finalTranscripts,
    captureMeta,
    captureNotice,
    error,
    startRecording,
    stopRecording,
    clearTranscripts,
  };
}
