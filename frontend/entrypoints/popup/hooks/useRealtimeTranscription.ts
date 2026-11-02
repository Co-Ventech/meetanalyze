import { useState, useRef, useCallback } from 'react';

export interface UseRealtimeTranscriptionOptions {
  apiBaseUrl?: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
}

export function useRealtimeTranscription({
  apiBaseUrl = 'http://localhost:5000',
  onTranscript,
  onError,
}: UseRealtimeTranscriptionOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscripts, setFinalTranscripts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPermissionRequired, setIsPermissionRequired] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
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
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
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

      // 2. Request microphone audio stream
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
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
          throw new Error('Microphone permission required. Chrome does not allow prompts in extension popups—please grant permission once via the permission tab.');
        }
        throw micErr;
      }
      mediaStreamRef.current = stream;

      // 3. Initialize AudioContext
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioCtx();
      audioContextRef.current = audioContext;
      const sampleRate = audioContext.sampleRate;

      // 4. Connect to AssemblyAI Streaming v3 WebSocket
      // universal-3-6-pro is the flagship streaming model (32 languages, native code-switching)
      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?token=${token}&sample_rate=${sampleRate}&speech_model=universal-3-6-pro`;
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setIsConnecting(false);
        setIsRecording(true);
        console.log('Connected to AssemblyAI Streaming v3');

        // 5. Pipe microphone audio chunks to WebSocket as 16-bit PCM
        const source = audioContext.createMediaStreamSource(stream);
        // 2048 buffer size gives ~40-100ms chunks depending on sample rate
        const processor = audioContext.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (socket.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmBuffer = floatTo16BitPCM(inputData);
            socket.send(pcmBuffer);
          }
        };

        source.connect(processor);
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
    isPermissionRequired,
    partialTranscript,
    finalTranscripts,
    error,
    startRecording,
    stopRecording,
    clearTranscripts,
  };
}
