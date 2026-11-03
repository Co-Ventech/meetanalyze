import type { TranscriptTurn, PartialTranscriptState, SpeakerInfo } from '../common/types';

declare const chrome: any;

let socket: WebSocket | null = null;
let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let tabStream: MediaStream | null = null;
let processor: ScriptProcessorNode | null = null;
let micAnalyser: AnalyserNode | null = null;
let tabAnalyser: AnalyserNode | null = null;
let speakerPollInterval: any = null;

let isRecording = false;
let isTabAudioCaptured = false;
let targetTabId: number | null = null;

// Speaker detection state
let speakerInfo: SpeakerInfo = {
  selfName: 'You',
  activeSpeaker: null,
  allParticipants: [],
  guests: [],
};

let currentSpeaker = {
  name: 'You',
  isSelf: true,
};

let partialState: PartialTranscriptState = {
  speaker: 'You',
  isSelf: true,
  text: '',
};

let finalTranscripts: TranscriptTurn[] = [];

// Helper to calculate RMS audio energy from an AnalyserNode
function getStreamVolume(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const val = (data[i] - 128) / 128;
    sum += val * val;
  }
  return Math.sqrt(sum / data.length);
}

// Convert Float32 audio samples from Web Audio API to 16-bit Linear PCM (Little Endian)
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

// Poll Google Meet content script for active speaker & participant names
function refreshSpeakerInfo() {
  if (!targetTabId) return;

  try {
    chrome.tabs?.sendMessage?.(targetTabId, { type: 'GET_SPEAKER_INFO' }, (res: any) => {
      if (chrome.runtime?.lastError) {
        // Tab may have navigated or closed
        return;
      }
      if (res && res.selfName) {
        speakerInfo = {
          selfName: res.selfName || 'You',
          activeSpeaker: res.activeSpeaker || null,
          allParticipants: Array.isArray(res.allParticipants) ? res.allParticipants : [],
          guests: Array.isArray(res.guests) ? res.guests : [],
        };
      }
    });
  } catch (err) {
    console.warn('[Offscreen] Error polling speaker info:', err);
  }
}

function cleanupAudio() {
  if (speakerPollInterval) {
    clearInterval(speakerPollInterval);
    speakerPollInterval = null;
  }
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (micAnalyser) {
    micAnalyser.disconnect();
    micAnalyser = null;
  }
  if (tabAnalyser) {
    tabAnalyser.disconnect();
    tabAnalyser = null;
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
  initialTranscripts: any[] = [],
  meetTabId?: number
) {
  if (!token) {
    throw new Error('No AssemblyAI streaming token provided to offscreen recorder.');
  }

  isRecording = true;
  targetTabId = meetTabId || null;
  partialState = { speaker: 'You', isSelf: true, text: '' };

  // Convert any string items to structured TranscriptTurn
  finalTranscripts = Array.isArray(initialTranscripts)
    ? initialTranscripts.map((item, idx) => {
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
      })
    : [];

  // Poll Google Meet tab for participant names every 1.5s
  refreshSpeakerInfo();
  speakerPollInterval = setInterval(refreshSpeakerInfo, 1500);

  // 1. Acquire Google Meet Tab Audio via streamId
  if (streamId) {
    try {
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

  // 3. Initialize AudioContext and mixing + analysis nodes
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  audioContext = new AudioCtx();

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const sampleRate = audioContext.sampleRate;

  // Analyser nodes for independent volume tracking
  micAnalyser = audioContext.createAnalyser();
  micAnalyser.fftSize = 256;

  tabAnalyser = audioContext.createAnalyser();
  tabAnalyser.fftSize = 256;

  // 4. Connect to AssemblyAI Streaming v3 WebSocket
  const wsUrl = `wss://streaming.assemblyai.com/v3/ws?token=${token}&sample_rate=${sampleRate}&speech_model=universal-3-6-pro`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('[Offscreen] Connected to AssemblyAI Streaming v3');

    if (!audioContext) return;

    processor = audioContext.createScriptProcessor(2048, 1, 1);

    // Route 1: Microphone (Local User)
    if (micStream && micAnalyser) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      const micGain = audioContext.createGain();
      micGain.gain.value = 1.0;
      micSource.connect(micGain);
      micGain.connect(processor);
      micSource.connect(micAnalyser);
    }

    // Route 2: Google Meet Tab (Guests / Other Participants)
    if (tabStream && tabAnalyser) {
      const tabSource = audioContext.createMediaStreamSource(tabStream);
      const tabGain = audioContext.createGain();
      tabGain.gain.value = 1.3;
      tabSource.connect(tabGain);
      tabGain.connect(processor);
      tabSource.connect(tabAnalyser);

      // Route tab audio to speakers/headphones so user hears the meeting
      tabSource.connect(audioContext.destination);
    }

    processor.onaudioprocess = (e) => {
      // Stream audio to AssemblyAI
      if (socket && socket.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBuffer = floatTo16BitPCM(inputData);
        socket.send(pcmBuffer);
      }

      // Check audio levels to determine who is speaking right now
      if (micAnalyser && tabAnalyser) {
        const micVol = getStreamVolume(micAnalyser);
        const tabVol = getStreamVolume(tabAnalyser);
        const threshold = 0.018;

        if (micVol > threshold && micVol > tabVol * 1.05) {
          // Local user is speaking
          currentSpeaker = {
            name: speakerInfo.selfName ? `${speakerInfo.selfName} (You)` : 'You',
            isSelf: true,
          };
        } else if (tabVol > threshold && tabVol > micVol * 1.05) {
          // A guest / other participant is speaking
          let guestName = speakerInfo.activeSpeaker;
          if (!guestName && speakerInfo.guests.length === 1) {
            guestName = speakerInfo.guests[0];
          }
          currentSpeaker = {
            name: guestName || 'Guest',
            isSelf: false,
          };
        }
      }

      // Zero out processor output to prevent local microphone feedback
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
            finalTranscripts.push({
              id: `turn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              speaker: currentSpeaker.name,
              isSelf: currentSpeaker.isSelf,
              text: text.trim(),
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            });

            partialState = {
              speaker: currentSpeaker.name,
              isSelf: currentSpeaker.isSelf,
              text: '',
            };
          } else {
            partialState = {
              speaker: currentSpeaker.name,
              isSelf: currentSpeaker.isSelf,
              text: text.trim(),
            };
          }

          // Broadcast to background (for persistence) and to popup/sidepanel
          chrome.runtime?.sendMessage?.({
            type: 'TRANSCRIPT_UPDATE',
            partialTranscript: partialState,
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
    startOffscreenRecording(
      message.streamId,
      message.token,
      message.initialTranscripts,
      message.targetTabId
    )
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
    partialState = { speaker: 'You', isSelf: true, text: '' };
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_RECORDING_STATE') {
    sendResponse({
      isRecording,
      isTabAudioCaptured,
      partialTranscript: partialState,
      finalTranscripts,
    });
    return true;
  }

  return false;
});

console.log('[Offscreen] MeetAnalyze offscreen audio processor with speaker diarization loaded.');
