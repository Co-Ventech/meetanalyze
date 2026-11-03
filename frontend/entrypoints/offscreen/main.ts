declare const chrome: any;

let socket: WebSocket | null = null;
let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let tabStream: MediaStream | null = null;
let processor: ScriptProcessorNode | null = null;

let isRecording = false;
let isTabAudioCaptured = false;
let partialTranscript = '';
let finalTranscripts: string[] = [];

// Helper to convert Float32 audio samples from Web Audio API to 16-bit Linear PCM (Little Endian)
function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const sample = input[i] ?? 0;
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function cleanupAudio() {
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (tabStream) {
    tabStream.getTracks().forEach((track) => track.stop());
    tabStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(console.error);
    audioContext = null;
  }
  isRecording = false;
  isTabAudioCaptured = false;
}

async function stopRecording() {
  isRecording = false;

  if (socket) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'Terminate' }));
    }
    setTimeout(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      socket = null;
    }, 500);
  }

  cleanupAudio();

  // Broadcast stopped state to background and popup/sidepanel
  try {
    chrome.runtime?.sendMessage?.({
      type: 'RECORDING_STOPPED',
      finalTranscripts,
    });
  } catch (err) {
    console.warn('[Offscreen] Could not broadcast RECORDING_STOPPED:', err);
  }
}

async function startOffscreenRecording(
  streamId?: string,
  token?: string,
  initialTranscripts: string[] = []
) {
  if (!token) {
    throw new Error('No AssemblyAI streaming token provided to offscreen recorder.');
  }

  isRecording = true;
  partialTranscript = '';
  finalTranscripts = Array.isArray(initialTranscripts) ? [...initialTranscripts] : [];

  // 1. Acquire Google Meet Tab Audio via streamId
  if (streamId) {
    try {
      // In Chromium, chromeMediaSource: 'tab' with getUserMedia requires both audio and video constraints
      try {
        tabStream = await navigator.mediaDevices.getUserMedia({
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

        // Stop video tracks immediately so only tab audio is captured
        tabStream.getVideoTracks().forEach((track) => track.stop());
        isTabAudioCaptured = true;
        console.log('[Offscreen] Captured Google Meet tab audio successfully.');
      } catch (errWithVideo) {
        console.warn('[Offscreen] getUserMedia with video+audio constraints failed, retrying audio-only:', errWithVideo);
        tabStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId,
            },
          } as unknown as MediaTrackConstraints,
        });
        isTabAudioCaptured = true;
      }
    } catch (tabErr) {
      console.error('[Offscreen] Failed to acquire Google Meet tab audio in offscreen document:', tabErr);
      isTabAudioCaptured = false;
    }
  }

  // 2. Acquire Microphone Audio (local user)
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch (micErr) {
    console.error('[Offscreen] Failed to acquire microphone in offscreen document:', micErr);
    throw micErr;
  }

  // 3. Initialize AudioContext and mix audio sources
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  audioContext = new AudioCtx();

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const sampleRate = audioContext.sampleRate;

  // 4. Connect to AssemblyAI Streaming v3 WebSocket
  const wsUrl = `wss://streaming.assemblyai.com/v3/ws?token=${token}&sample_rate=${sampleRate}&speech_model=universal-3-6-pro`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('[Offscreen] Connected to AssemblyAI Streaming v3');

    if (!audioContext) return;

    // 2048 buffer size produces ~40-100ms chunks (optimal for AssemblyAI v3)
    processor = audioContext.createScriptProcessor(2048, 1, 1);

    // Route 1: Connect microphone to processor (to transcribe user's voice)
    if (micStream) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      const micGain = audioContext.createGain();
      micGain.gain.value = 1.0;
      micSource.connect(micGain);
      micGain.connect(processor);
    }

    // Route 2: Connect Google Meet tab audio to processor (to transcribe other participants/guests)
    // AND route to audioContext.destination (so user can still hear other participants in their headphones/speakers!)
    if (tabStream) {
      const tabSource = audioContext.createMediaStreamSource(tabStream);
      const tabGain = audioContext.createGain();
      tabGain.gain.value = 1.3; // Boost remote guest audio slightly for higher STT accuracy
      tabSource.connect(tabGain);
      tabGain.connect(processor);

      // Route to destination so user hears the meeting output
      tabSource.connect(audioContext.destination);
    }

    processor.onaudioprocess = (e) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBuffer = floatTo16BitPCM(inputData);
        socket.send(pcmBuffer);
      }

      // Zero out processor output to prevent local microphone loopback
      const outputData = e.outputBuffer.getChannelData(0);
      outputData.fill(0);
    };

    processor.connect(audioContext.destination);

    // Broadcast connected status to background, popup, and sidepanel
    chrome.runtime?.sendMessage?.({
      type: 'RECORDING_STARTED',
      isTabAudioCaptured,
    });
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'Turn') {
        const text = data.transcript || '';
        const isEndOfTurn = !!data.end_of_turn;

        if (text.trim().length > 0) {
          if (isEndOfTurn) {
            finalTranscripts.push(text);
            partialTranscript = '';
          } else {
            partialTranscript = text;
          }

          // Broadcast to background (for persistence) and to popup/sidepanel
          chrome.runtime?.sendMessage?.({
            type: 'TRANSCRIPT_UPDATE',
            partialTranscript,
            finalTranscripts: [...finalTranscripts],
            isFinal: isEndOfTurn,
            isTabAudioCaptured,
          });
        }
      } else if (data.type === 'Termination') {
        console.log('[Offscreen] AssemblyAI session terminated cleanly');
      }
    } catch (parseError) {
      console.error('[Offscreen] Error parsing WebSocket message:', parseError);
    }
  };

  socket.onerror = (err) => {
    console.error('[Offscreen] AssemblyAI WebSocket error:', err);
    chrome.runtime?.sendMessage?.({
      type: 'RECORDING_ERROR',
      error: 'WebSocket connection error with AssemblyAI',
    });
    stopRecording();
  };

  socket.onclose = (event) => {
    console.log(`[Offscreen] WebSocket closed: code ${event.code}, reason: ${event.reason}`);
    stopRecording();
  };
}

// Listen for messages from background script or popup
chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
  if (message.type === 'START_OFFSCREEN_RECORDING') {
    startOffscreenRecording(message.streamId, message.token, message.initialTranscripts)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'STOP_OFFSCREEN_RECORDING') {
    stopRecording()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'CLEAR_TRANSCRIPTS') {
    finalTranscripts = [];
    partialTranscript = '';
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_RECORDING_STATE') {
    sendResponse({
      isRecording,
      isTabAudioCaptured,
      partialTranscript,
      finalTranscripts,
    });
    return true;
  }

  return false;
});

console.log('[Offscreen] MeetAnalyze offscreen audio processor loaded.');
