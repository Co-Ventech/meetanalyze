import { useState, useRef, useCallback } from 'react';
import { getGoogleMeetTab } from '../../utils/check-google-meet-connection';

declare const chrome: any;

export interface UseRealtimeTranscriptionOptions {
  apiBaseUrl?: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
}

// Helper to capture tab audio via Chrome MV3 tabCapture API
async function getTabAudioStream(targetTabId: number): Promise<MediaStream> {
  // Strategy 1: chrome.tabCapture.getMediaStreamId
  if (typeof chrome !== 'undefined' && chrome.tabCapture?.getMediaStreamId) {
    try {
      const streamId = await new Promise<string>((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId }, (id: string | null) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!id) {
            return reject(new Error('Failed to acquire tab media stream ID'));
          }
          resolve(id);
        });
      });

      console.log('[MeetAnalyze] Acquired tab mediaStreamId:', streamId);

      // In Chromium, chromeMediaSource: 'tab' with getUserMedia requires both audio and video constraints
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId,
            },
          } as unknown as MediaTrackConstraints,
          video: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId,
            },
          } as unknown as MediaTrackConstraints,
        });

        // Stop video tracks immediately so only tab audio is captured and resources are freed
        stream.getVideoTracks().forEach((track) => track.stop());
        return stream;
      } catch (errWithVideo) {
        console.warn('[MeetAnalyze] getUserMedia with video+audio constraints failed, attempting audio-only:', errWithVideo);
        // Fallback: try audio-only constraint
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId,
            },
          } as unknown as MediaTrackConstraints,
        });
        return stream;
      }
    } catch (streamIdErr) {
      console.warn('[MeetAnalyze] getMediaStreamId path failed, checking direct capture:', streamIdErr);
    }
  }

  // Strategy 2: Direct chrome.tabCapture.capture (supported in extension popup foreground)
  if (typeof chrome !== 'undefined' && chrome.tabCapture?.capture) {
    try {
      const stream = await new Promise<MediaStream>((resolve, reject) => {
        chrome.tabCapture.capture({ audio: true, video: false }, (resStream: MediaStream | null) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!resStream) {
            return reject(new Error('chrome.tabCapture.capture returned null stream'));
          }
          resolve(resStream);
        });
      });
      return stream;
    } catch (captureErr) {
      console.warn('[MeetAnalyze] Direct tabCapture.capture failed:', captureErr);
      throw captureErr;
    }
  }

  throw new Error('Tab capture is not supported or failed on this browser context');
}

export function useRealtimeTranscription({
  apiBaseUrl = 'http://localhost:5000',
  onTranscript,
  onError,
}: UseRealtimeTranscriptionOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTabAudioCaptured, setIsTabAudioCaptured] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscripts, setFinalTranscripts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPermissionRequired, setIsPermissionRequired] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const tabStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Helper to convert Float32 audio samples from Web Audio API to 16-bit Linear PCM (Little Endian)
  const floatTo16BitPCM = (input: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++) {
      const sample = input[i] ?? 0;
      const s = Math.max(-1, Math.min(1, sample));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  };

  const cleanupAudio = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (tabStreamRef.current) {
      tabStreamRef.current.getTracks().forEach((track) => track.stop());
      tabStreamRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
    setIsTabAudioCaptured(false);
  };

  const stopRecording = useCallback(() => {
    setIsConnecting(false);
    setIsRecording(false);

    if (socketRef.current) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        // Send graceful shutdown terminate message per AssemblyAI v3 spec
        socketRef.current.send(JSON.stringify({ type: 'Terminate' }));
      }
      setTimeout(() => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.close();
        }
        socketRef.current = null;
      }, 500);
    }

    cleanupAudio();
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setIsPermissionRequired(false);
      setIsConnecting(true);

      // 1. Fetch short-lived temporary token from backend
      const tokenRes = await fetch(`${apiBaseUrl}/api/v1/transcription/token`);
      if (!tokenRes.ok) {
        throw new Error(`Failed to fetch streaming token from backend (HTTP ${tokenRes.status})`);
      }
      const { token } = await tokenRes.json();
      if (!token) {
        throw new Error('No token returned from backend server.');
      }

      // 2. Capture Google Meet Tab Audio (for guest/other participants' voices)
      let tabStream: MediaStream | null = null;
      const meetTab = await getGoogleMeetTab();
      if (meetTab?.id) {
        try {
          tabStream = await getTabAudioStream(meetTab.id);
          tabStreamRef.current = tabStream;
          setIsTabAudioCaptured(true);
          console.log('[MeetAnalyze] Captured Google Meet tab audio stream successfully:', tabStream.getAudioTracks());
        } catch (tabErr) {
          console.error('[MeetAnalyze] Tab capture failed:', tabErr);
          setIsTabAudioCaptured(false);
        }
      } else {
        console.warn('[MeetAnalyze] No Google Meet tab found during startRecording.');
        setIsTabAudioCaptured(false);
      }

      // 3. Capture Microphone Audio (for user's voice)
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        micStreamRef.current = micStream;
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
          throw new Error('Microphone permission required. Please grant permission once in the permission tab.');
        }
        throw micErr;
      }

      // 4. Initialize AudioContext and mix audio sources
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioCtx();
      audioContextRef.current = audioContext;

      // Chrome starts AudioContext in 'suspended' state by default; resume it
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const sampleRate = audioContext.sampleRate;

      // 5. Connect to AssemblyAI Streaming v3 WebSocket
      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?token=${token}&sample_rate=${sampleRate}&speech_model=universal-3-6-pro`;
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setIsConnecting(false);
        setIsRecording(true);
        console.log('Connected to AssemblyAI Streaming v3');

        // 2048 buffer size produces ~40-100ms chunks (optimal for AssemblyAI v3)
        const processor = audioContext.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        // Route 1: Connect microphone to processor (to transcribe local user's voice)
        if (micStream) {
          const micSource = audioContext.createMediaStreamSource(micStream);
          const micGain = audioContext.createGain();
          micGain.gain.value = 1.0;
          micSource.connect(micGain);
          micGain.connect(processor);
        }

        // Route 2: Connect Google Meet tab audio to processor (to transcribe other participants/guests)
        // AND route to audioContext.destination (so the user can still hear other participants in their headphones/speakers!)
        if (tabStream) {
          const tabSource = audioContext.createMediaStreamSource(tabStream);
          const tabGain = audioContext.createGain();
          tabGain.gain.value = 1.3; // Give remote participants a slight boost for crisp STT
          tabSource.connect(tabGain);
          tabGain.connect(processor);

          // Route to destination so user hears the meeting output
          tabSource.connect(audioContext.destination);
        }

        processor.onaudioprocess = (e) => {
          if (socket.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmBuffer = floatTo16BitPCM(inputData);
            socket.send(pcmBuffer);
          }

          // Zero out processor output to prevent local microphone loopback/echo
          const outputData = e.outputBuffer.getChannelData(0);
          outputData.fill(0);
        };

        // Note: processor must be connected to destination for Chrome to process onaudioprocess
        processor.connect(audioContext.destination);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'Turn') {
            const text = data.transcript || '';
            const isEndOfTurn = !!data.end_of_turn;

            if (text.trim().length > 0) {
              if (isEndOfTurn) {
                setFinalTranscripts((prev) => [...prev, text]);
                setPartialTranscript('');
                onTranscript?.(text, true);
              } else {
                setPartialTranscript(text);
                onTranscript?.(text, false);
              }
            }
          } else if (data.type === 'Termination') {
            console.log('AssemblyAI session terminated cleanly');
          }
        } catch (parseError) {
          console.error('Error parsing WebSocket message:', parseError);
        }
      };

      socket.onerror = (err) => {
        console.error('AssemblyAI WebSocket error:', err);
        const errObj = new Error('WebSocket connection error');
        setError(errObj.message);
        onError?.(errObj);
        stopRecording();
      };

      socket.onclose = (event) => {
        console.log(`WebSocket closed: code ${event.code}, reason: ${event.reason}`);
        setIsRecording(false);
        setIsConnecting(false);
        cleanupAudio();
      };
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error('Failed to start recording:', e);
      setError(e.message);
      setIsConnecting(false);
      setIsRecording(false);
      cleanupAudio();
      onError?.(e);
    }
  }, [apiBaseUrl, onTranscript, onError, stopRecording]);

  const clearTranscripts = useCallback(() => {
    setFinalTranscripts([]);
    setPartialTranscript('');
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
