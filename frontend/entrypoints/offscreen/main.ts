import type { TranscriptTurn, PartialTranscriptState, SpeakerInfo, SpeakerInterval } from '../common/types';

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
  intervals: [],
};

let speakerIntervals: SpeakerInterval[] = [];
let lastGuestSpeaker: string | null = null;
let guestOverrides: Record<string, string> = {};
let sessionAnnouncedJoins = new Set<string>();

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
    const val = ((data[i] ?? 128) - 128) / 128;
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

// Find speaker from Google Meet active speaker intervals that overlaps a given time window
function matchSpeakerFromIntervals(windowStart: number, windowEnd: number): string | null {
  if (!speakerIntervals || speakerIntervals.length === 0) return null;

  for (let i = speakerIntervals.length - 1; i >= 0; i--) {
    const interval = speakerIntervals[i];
    if (interval && windowStart <= interval.end && windowEnd >= interval.start) {
      const lower = interval.speaker.toLowerCase();
      if (lower !== speakerInfo.selfName.toLowerCase() && lower !== 'you') {
        return interval.speaker;
      }
    }
  }

  return null;
}

// Apply updated speaker info and retroactively correct placeholder turns
function applySpeakerInfoUpdate(newInfo: Partial<SpeakerInfo>) {
  if (!newInfo) return;

  speakerInfo = {
    selfName: newInfo.selfName || speakerInfo.selfName || 'You',
    activeSpeaker: newInfo.activeSpeaker ?? speakerInfo.activeSpeaker,
    allParticipants: Array.isArray(newInfo.allParticipants) ? newInfo.allParticipants : speakerInfo.allParticipants,
    guests: Array.isArray(newInfo.guests) ? newInfo.guests : speakerInfo.guests,
    intervals: Array.isArray(newInfo.intervals) ? newInfo.intervals : speakerInfo.intervals,
    recentJoiners: Array.isArray(newInfo.recentJoiners) ? newInfo.recentJoiners : speakerInfo.recentJoiners,
  };

  if (Array.isArray(newInfo.intervals) && newInfo.intervals.length > 0) {
    speakerIntervals = newInfo.intervals;
  }

  // Update last guest speaker if activeSpeaker is a guest
  if (
    speakerInfo.activeSpeaker &&
    speakerInfo.activeSpeaker.toLowerCase() !== speakerInfo.selfName.toLowerCase() &&
    speakerInfo.activeSpeaker.toLowerCase() !== 'you'
  ) {
    lastGuestSpeaker = speakerInfo.activeSpeaker;
  } else if (!lastGuestSpeaker && speakerInfo.guests.length === 1) {
    lastGuestSpeaker = speakerInfo.guests[0] ?? null;
  }

  // Dynamic Retroactive Turn Correction:
  // When an active speaker is confirmed, resolve turns from the last 6 seconds
  const now = Date.now();
  let updatedAnyTurn = false;

  finalTranscripts = finalTranscripts.map((turn) => {
    if (turn.isSelf || turn.systemNotice) return turn;

    const turnEnd = turn.endMs || now;
    const turnStart = turn.startMs || (turnEnd - 3000);

    // Only inspect recent turns within the last 6 seconds
    if (now - turnEnd < 6000) {
      const matchingIntervalSpeaker = matchSpeakerFromIntervals(turnStart, turnEnd);
      const targetSpeaker =
        matchingIntervalSpeaker ||
        (speakerInfo.guests.length === 1 ? speakerInfo.guests[0] : null);

      if (
        targetSpeaker &&
        targetSpeaker !== turn.speaker &&
        (turn.speaker === 'Client' || turn.speaker === 'Guest')
      ) {
        updatedAnyTurn = true;
        const overridden = guestOverrides[targetSpeaker] || targetSpeaker;
        return { ...turn, speaker: overridden };
      }
    }
    return turn;
  });

  if (partialState && !partialState.isSelf) {
    const matchingIntervalSpeaker = matchSpeakerFromIntervals(now - 2000, now);
    const targetSpeaker =
      matchingIntervalSpeaker ||
      lastGuestSpeaker ||
      (speakerInfo.guests.length === 1 ? speakerInfo.guests[0] : null);

    if (
      targetSpeaker &&
      targetSpeaker !== partialState.speaker &&
      (partialState.speaker === 'Client' || partialState.speaker === 'Guest')
    ) {
      const overridden = guestOverrides[targetSpeaker] || targetSpeaker;
      partialState = { ...partialState, speaker: overridden };
      updatedAnyTurn = true;
    }
  }

  if (updatedAnyTurn) {
    chrome.runtime?.sendMessage?.({
      type: 'TRANSCRIPT_UPDATE',
      partialTranscript: partialState,
      finalTranscripts: [...finalTranscripts],
      isFinal: false,
      isTabAudioCaptured,
    }).catch(() => {});
  }
}

// Poll Google Meet content script for active speaker & participant names via Background SW
function refreshSpeakerInfo() {
  if (!targetTabId) return;

  try {
    chrome.runtime?.sendMessage?.(
      { type: 'POLL_SPEAKER_INFO', targetTabId },
      (res: any) => {
        if (chrome.runtime?.lastError) return;
        if (res?.success && res?.speakerInfo) {
          applySpeakerInfoUpdate(res.speakerInfo);
        }
      }
    );
  } catch (err) {
    console.warn('[Offscreen] Error polling speaker info via background:', err);
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
  meetTabId?: number,
  wsHost: string = 'streaming.assemblyai.com'
) {
  if (!token) {
    throw new Error('No AssemblyAI streaming token provided to offscreen recorder.');
  }

  isRecording = true;
  targetTabId = meetTabId || null;
  partialState = { speaker: 'You', isSelf: true, text: '' };

  // Establish initial participant baseline so existing attendees don't trigger "joined" tags
  sessionAnnouncedJoins.clear();
  if (speakerInfo?.guests) {
    for (const g of speakerInfo.guests) {
      if (g) sessionAnnouncedJoins.add(g.toLowerCase());
    }
  }

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

  // Poll Google Meet tab for participant names every 500ms
  refreshSpeakerInfo();
  speakerPollInterval = setInterval(refreshSpeakerInfo, 500);

  // 1. Acquire Google Meet Tab Audio via streamId (Client channel)
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

  // 2. Acquire Microphone Audio (Support Agent / Local User channel)
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

  // Analyser nodes for independent volume tracking (Option 2: separate channel analysis)
  micAnalyser = audioContext.createAnalyser();
  micAnalyser.fftSize = 256;

  tabAnalyser = audioContext.createAnalyser();
  tabAnalyser.fftSize = 256;

  // 4. Connect to AssemblyAI Streaming v3 WebSocket
  const host = wsHost || 'streaming.assemblyai.com';
  const wsUrl = `wss://${host}/v3/ws?token=${token}&sample_rate=${sampleRate}&speech_model=universal-3-6-pro`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log(`[Offscreen] Connected to AssemblyAI Streaming v3 on ${host}`);

    if (!audioContext) return;

    processor = audioContext.createScriptProcessor(2048, 1, 1);

    // Route 1: Microphone (Local Support Agent)
    if (micStream && micAnalyser) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      const micGain = audioContext.createGain();
      micGain.gain.value = 1.0;
      micSource.connect(micGain);
      micGain.connect(processor);
      micSource.connect(micAnalyser);
    }

    // Route 2: Google Meet Tab (Client / Remote Participants)
    if (tabStream && tabAnalyser) {
      const tabSource = audioContext.createMediaStreamSource(tabStream);
      const tabGain = audioContext.createGain();
      tabGain.gain.value = 1.3;
      tabSource.connect(tabGain);
      tabGain.connect(processor);
      tabSource.connect(tabAnalyser);

      // Route tab audio to speakers/headphones so agent hears the meeting
      tabSource.connect(audioContext.destination);
    }

    processor.onaudioprocess = (e) => {
      // Stream mixed audio to AssemblyAI
      if (socket && socket.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBuffer = floatTo16BitPCM(inputData);
        socket.send(pcmBuffer);
      }

      // Check audio levels between the two independent streams
      if (micAnalyser && tabAnalyser) {
        const micVol = getStreamVolume(micAnalyser);
        const tabVol = getStreamVolume(tabAnalyser);
        const threshold = 0.015;
        const now = Date.now();

        if (micVol > threshold && micVol > tabVol * 1.05) {
          // Channel 1: Local Agent is speaking on mic
          const selfDisplayName =
            speakerInfo.selfName && speakerInfo.selfName.toLowerCase() !== 'you'
              ? `${speakerInfo.selfName} (You)`
              : 'You';

          currentSpeaker = {
            name: selfDisplayName,
            isSelf: true,
          };
        } else if (tabVol > threshold && tabVol > micVol * 1.05) {
          // Channel 2: Remote participant(s) speaking on Google Meet tab
          let matchedClientName: string | null = null;

          // Priority 1: Match against active speaker interval timeline from Google Meet DOM
          matchedClientName = matchSpeakerFromIntervals(now - 1400, now);

          // Priority 2: Google Meet live active speaker tile
          if (!matchedClientName && speakerInfo.activeSpeaker) {
            const lower = speakerInfo.activeSpeaker.toLowerCase();
            if (lower !== speakerInfo.selfName.toLowerCase() && lower !== 'you') {
              matchedClientName = speakerInfo.activeSpeaker;
            }
          }

          // Priority 3: Newly joined participant (joined within last 15 seconds)
          if (!matchedClientName && speakerInfo.recentJoiners && speakerInfo.recentJoiners.length > 0) {
            const latest = speakerInfo.recentJoiners.find((j) => now - j.joinedAt < 15000);
            if (latest && speakerInfo.guests.includes(latest.name)) {
              matchedClientName = latest.name;
            }
          }

          // Priority 4: Exactly 1 guest in the meeting (1-on-1 call guarantee)
          if (!matchedClientName && speakerInfo.guests.length === 1) {
            matchedClientName = speakerInfo.guests[0] ?? null;
          }

          // Priority 5: Multi-person call with recent active guest speaker
          if (
            !matchedClientName &&
            speakerInfo.guests.length > 1 &&
            lastGuestSpeaker &&
            speakerInfo.guests.includes(lastGuestSpeaker)
          ) {
            matchedClientName = lastGuestSpeaker;
          }

          if (matchedClientName) {
            lastGuestSpeaker = matchedClientName;
          }

          const effectiveName =
            (matchedClientName && guestOverrides[matchedClientName]) ||
            matchedClientName ||
            'Client';

          currentSpeaker = {
            name: effectiveName,
            isSelf: false,
          };
        }
      }

      // Zero out processor output to prevent local microphone feedback loop
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
          const now = Date.now();
          let turnSpeaker = currentSpeaker.name;

          // If it was labeled generic "Client" or "Guest", check if an overlapping speaker event resolved it
          if (!currentSpeaker.isSelf && (turnSpeaker === 'Client' || turnSpeaker === 'Guest')) {
            const resolved =
              matchSpeakerFromIntervals(now - 2500, now) ||
              (speakerInfo.activeSpeaker && speakerInfo.activeSpeaker.toLowerCase() !== 'you'
                ? speakerInfo.activeSpeaker
                : null) ||
              (speakerInfo.guests.length === 1 ? speakerInfo.guests[0] : null) ||
              lastGuestSpeaker;
            if (resolved) {
              turnSpeaker = guestOverrides[resolved] || resolved;
            }
          }

          if (isEndOfTurn) {
            finalTranscripts.push({
              id: `turn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              speaker: turnSpeaker,
              isSelf: currentSpeaker.isSelf,
              text: text.trim(),
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              startMs: now - 3500,
              endMs: now,
            });

            partialState = {
              speaker: turnSpeaker,
              isSelf: currentSpeaker.isSelf,
              text: '',
            };
          } else {
            partialState = {
              speaker: turnSpeaker,
              isSelf: currentSpeaker.isSelf,
              text: text.trim(),
            };
          }

          // Broadcast to background and UI
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
      message.targetTabId,
      message.host
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
    sessionAnnouncedJoins.clear();
    if (speakerInfo?.guests) {
      for (const g of speakerInfo.guests) {
        if (g) sessionAnnouncedJoins.add(g.toLowerCase());
      }
    }
    sendResponse({ success: true });
    return true;
  }

  // Handle speaker info dispatch from content script or background
  if (message.type === 'SPEAKER_INFO_DISPATCH' || message.type === 'SPEAKER_INFO_UPDATED') {
    if (message.speakerInfo) {
      applySpeakerInfoUpdate(message.speakerInfo);
    }
    return false;
  }

  // Dynamic participant joined notification (strictly deduplicated)
  if (message.type === 'PARTICIPANTS_JOINED') {
    const joined = Array.isArray(message.joined) ? message.joined : [message.name];

    if (isRecording) {
      let anyAdded = false;
      for (const name of joined) {
        if (!name || name.toLowerCase() === 'you' || name.toLowerCase() === speakerInfo.selfName.toLowerCase()) continue;
        const lower = name.toLowerCase();

        // If already announced during this active recording session, do not repeat tag!
        if (sessionAnnouncedJoins.has(lower)) {
          continue;
        }
        sessionAnnouncedJoins.add(lower);
        anyAdded = true;

        finalTranscripts.push({
          id: `sys_join_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          speaker: 'System',
          isSelf: false,
          text: `${name} joined the meeting`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          systemNotice: true,
        });
      }

      if (anyAdded) {
        chrome.runtime?.sendMessage?.({
          type: 'TRANSCRIPT_UPDATE',
          partialTranscript: partialState,
          finalTranscripts: [...finalTranscripts],
          isFinal: true,
          isTabAudioCaptured,
        }).catch(() => {});
      }
    }
    return false;
  }

  // Dynamic participant left notification (strictly deduplicated)
  if (message.type === 'PARTICIPANTS_LEFT') {
    const left = Array.isArray(message.left) ? message.left : [message.name];

    if (isRecording) {
      let anyLeft = false;
      for (const name of left) {
        if (!name || name.toLowerCase() === 'you' || name.toLowerCase() === speakerInfo.selfName.toLowerCase()) continue;
        const lower = name.toLowerCase();

        // Remove from announced joins so if they re-join later they can be announced
        sessionAnnouncedJoins.delete(lower);
        if (lastGuestSpeaker?.toLowerCase() === lower) {
          lastGuestSpeaker = null;
        }
        anyLeft = true;

        finalTranscripts.push({
          id: `sys_leave_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          speaker: 'System',
          isSelf: false,
          text: `${name} left the meeting`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          systemNotice: true,
        });
      }

      if (anyLeft) {
        chrome.runtime?.sendMessage?.({
          type: 'TRANSCRIPT_UPDATE',
          partialTranscript: partialState,
          finalTranscripts: [...finalTranscripts],
          isFinal: true,
          isTabAudioCaptured,
        }).catch(() => {});
      }
    }
    return false;
  }

  // Manual guest name override from user in UI
  if (message.type === 'SET_GUEST_NAME_OFFSCREEN') {
    const originalName = message.originalName?.trim();
    const newName = message.name?.trim();

    if (newName) {
      if (originalName) {
        guestOverrides[originalName] = newName;
      } else if (speakerInfo.guests.length === 1 && speakerInfo.guests[0]) {
        guestOverrides[speakerInfo.guests[0]] = newName;
      } else if (lastGuestSpeaker) {
        guestOverrides[lastGuestSpeaker] = newName;
      }

      finalTranscripts = finalTranscripts.map((turn) => {
        if (!turn.isSelf && !turn.systemNotice) {
          if (originalName && turn.speaker === originalName) {
            return { ...turn, speaker: newName };
          } else if (
            !originalName &&
            (turn.speaker === 'Guest' || turn.speaker === 'Client' || turn.speaker === lastGuestSpeaker)
          ) {
            return { ...turn, speaker: newName };
          }
        }
        return turn;
      });

      if (partialState && !partialState.isSelf) {
        if (originalName && partialState.speaker === originalName) {
          partialState = { ...partialState, speaker: newName };
        } else if (!originalName) {
          partialState = { ...partialState, speaker: newName };
        }
      }

      chrome.runtime?.sendMessage?.({
        type: 'TRANSCRIPT_UPDATE',
        partialTranscript: partialState,
        finalTranscripts: [...finalTranscripts],
        isFinal: false,
        isTabAudioCaptured,
      }).catch(() => {});
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_RECORDING_STATE') {
    sendResponse({
      isRecording,
      isTabAudioCaptured,
      partialTranscript: partialState,
      finalTranscripts,
      speakerInfo,
    });
    return true;
  }

  return false;
});

console.log('[Offscreen] MeetAnalyze offscreen audio processor with hybrid dual-stream speaker diarization loaded.');
