import type {
  TranscriptTurn,
  PartialTranscriptState,
  SpeakerInfo,
  SpeakerInterval,
  AudioChannel,
  AttributionMethod,
  AttributionLogTurn,
  AttributionLogExport,
} from '../common/types';

declare const chrome: any;

// ---------------------------------------------------------------------------
// Tuning constants (also written into the exported attribution log so that
// offline evaluation knows which settings produced a given log).
// ---------------------------------------------------------------------------
const DOM_LEAD_TOLERANCE_MS = 300; // DOM indicator may light up slightly before ASR word start
const DOM_LAG_TOLERANCE_MS = 1000; // DOM indicator typically lags the audio it reflects
const MIC_BLEED_RATIO = 3; // drop a mic turn if tab energy > 3x mic energy over its span
const ENERGY_HISTORY_MS = 120000;
const PROCESSOR_BUFFER_SIZE = 2048;

/**
 * Each audio source gets its own AssemblyAI streaming session:
 *  - mic: local user only, diarization off, every turn is hard-labelled as "You".
 *  - tab: remote participants only, diarization on, turns mapped to Meet names.
 * Previously both were mixed into one stream and self/remote was guessed from
 * instantaneous volume at the moment a Turn message arrived.
 */
interface ChannelSession {
  channel: AudioChannel;
  socket: WebSocket | null;
  processor: ScriptProcessorNode | null;
  source: MediaStreamAudioSourceNode | null;
  stream: MediaStream;
  /** Epoch ms corresponding to t=0 of the audio sent on this socket. */
  audioStartEpoch: number | null;
}

let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let tabStream: MediaStream | null = null;
let micSession: ChannelSession | null = null;
let tabSession: ChannelSession | null = null;
let tabPlaybackSource: MediaStreamAudioSourceNode | null = null;
let speakerPollInterval: any = null;

let isRecording = false;
let isStopping = false;
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
/** cluster -> raw Meet name -> accumulated DOM overlap ms (votes). */
let clusterVotes: Record<string, Record<string, number>> = {};
let sessionAnnouncedJoins = new Set<string>();

const partialByChannel: Record<AudioChannel, PartialTranscriptState | null> = { mic: null, tab: null };
let partialState: PartialTranscriptState = { speaker: 'You', isSelf: true, text: '' };

let finalTranscripts: TranscriptTurn[] = [];

// ---------------------------------------------------------------------------
// Attribution instrumentation (P0): everything needed to measure how often and
// why attribution goes wrong, on one epoch-ms clock.
// ---------------------------------------------------------------------------
let logTurns: AttributionLogTurn[] = [];
let logDomIntervals = new Map<string, SpeakerInterval>();
let logRosterEvents: AttributionLogExport['rosterEvents'] = [];
let logRevisions: AttributionLogExport['revisions'] = [];
let logSessions: AttributionLogExport['sessions'] = [];

function resetAttributionLog() {
  logTurns = [];
  logDomIntervals = new Map();
  logRosterEvents = [];
  logRevisions = [];
  logSessions = [];
}

function buildAttributionExport(): AttributionLogExport {
  const finalById = new Map(finalTranscripts.map((t) => [t.id, t.speaker]));
  let version = 'unknown';
  try {
    version = chrome.runtime?.getManifest?.()?.version || version;
  } catch {}
  return {
    format: 'meetanalyze-attribution-log/1',
    exportedAt: Date.now(),
    extensionVersion: version,
    selfName: speakerInfo.selfName,
    constants: { DOM_LEAD_TOLERANCE_MS, DOM_LAG_TOLERANCE_MS, MIC_BLEED_RATIO },
    sessions: [...logSessions],
    turns: logTurns.map((t) => ({ ...t, finalSpeaker: finalById.get(t.turnId) ?? t.finalSpeaker ?? null })),
    domIntervals: Array.from(logDomIntervals.values()).sort((a, b) => a.start - b.start),
    rosterEvents: [...logRosterEvents],
    revisions: [...logRevisions],
  };
}

function persistAttributionLog() {
  try {
    chrome.storage?.local?.set({ attributionLog: buildAttributionExport() });
  } catch (err) {
    console.warn('[Offscreen] Could not persist attribution log:', err);
  }
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------
const energyHistory: Record<AudioChannel, { t: number; rms: number }[]> = { mic: [], tab: [] };

function rmsOf(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] ?? 0;
    sum += v * v;
  }
  return buf.length ? Math.sqrt(sum / buf.length) : 0;
}

function recordEnergy(channel: AudioChannel, rms: number) {
  const now = Date.now();
  const hist = energyHistory[channel];
  hist.push({ t: now, rms });
  const cutoff = now - ENERGY_HISTORY_MS;
  while (hist.length > 0 && (hist[0]?.t ?? 0) < cutoff) hist.shift();
}

function meanEnergy(channel: AudioChannel, start: number, end: number): number | null {
  let sum = 0;
  let n = 0;
  for (const s of energyHistory[channel]) {
    if (s.t >= start && s.t <= end) {
      sum += s.rms;
      n++;
    }
  }
  return n ? sum / n : null;
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

// Helper to verify that text is in the English / Latin alphabet
// Rejects foreign alphabets (Arabic, Urdu, Cyrillic, Devanagari, CJK, Hebrew, etc.)
function isEnglishTranscript(text: string): boolean {
  if (!text || !text.trim()) return false;
  const nonLatinRegex = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿ऀ-ॿЀ-ӿ一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯֐-׿฀-๿Ͱ-Ͽ]/;
  if (nonLatinRegex.test(text)) return false;
  if (!/[a-zA-Z0-9]/.test(text)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Speaker helpers
// ---------------------------------------------------------------------------
function isSelfName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower === 'you' || lower === speakerInfo.selfName.toLowerCase();
}

function displayName(name: string): string {
  return guestOverrides[name] || name;
}

function selfDisplayName(): string {
  return speakerInfo.selfName && speakerInfo.selfName.toLowerCase() !== 'you'
    ? `${speakerInfo.selfName} (You)`
    : 'You';
}

function isPlaceholder(speaker: string): boolean {
  return speaker === 'Client' || speaker === 'Guest';
}

/** Remote Meet speakers whose DOM "speaking" intervals overlap the window, by total overlap. */
function domCandidates(start: number, end: number): { speaker: string; overlapMs: number }[] {
  const ws = start - DOM_LEAD_TOLERANCE_MS;
  const we = end + DOM_LAG_TOLERANCE_MS;
  const totals = new Map<string, number>();
  for (const iv of speakerIntervals) {
    if (!iv || isSelfName(iv.speaker)) continue;
    const overlap = Math.min(we, iv.end) - Math.max(ws, iv.start);
    if (overlap > 0) totals.set(iv.speaker, (totals.get(iv.speaker) || 0) + overlap);
  }
  return Array.from(totals, ([speaker, overlapMs]) => ({ speaker, overlapMs: Math.round(overlapMs) })).sort(
    (a, b) => b.overlapMs - a.overlapMs
  );
}

function addClusterVote(cluster: string, name: string, weight: number) {
  const votes = (clusterVotes[cluster] ||= {});
  votes[name] = (votes[name] || 0) + weight;
}

function clusterLeader(cluster: string | null | undefined): string | null {
  if (!cluster) return null;
  const votes = clusterVotes[cluster];
  if (!votes) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const [name, score] of Object.entries(votes)) {
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

interface TabAttribution {
  name: string | null;
  method: AttributionMethod;
  candidates: { speaker: string; overlapMs: number }[];
  clusterVoteName: string | null;
}

/**
 * Attribute remote (tab) speech in [start, end] to a Meet participant.
 * Order: 1:1 call guarantee > DOM interval overlap over the turn's real word span >
 * AssemblyAI cluster's majority name > live active tile > last guest speaker.
 */
function attributeTabSpeech(start: number, end: number, cluster: string | null): TabAttribution {
  const candidates = domCandidates(start, end);
  const clusterVoteName = clusterLeader(cluster);
  const guests = speakerInfo.guests;

  if (guests.length === 1 && guests[0]) {
    return { name: guests[0], method: 'single-guest', candidates, clusterVoteName };
  }
  if (candidates[0]) {
    return { name: candidates[0].speaker, method: 'dom-overlap', candidates, clusterVoteName };
  }
  if (clusterVoteName) {
    return { name: clusterVoteName, method: 'cluster-vote', candidates, clusterVoteName };
  }
  if (speakerInfo.activeSpeaker && !isSelfName(speakerInfo.activeSpeaker)) {
    return { name: speakerInfo.activeSpeaker, method: 'dom-active-now', candidates, clusterVoteName };
  }
  if (lastGuestSpeaker && guests.includes(lastGuestSpeaker)) {
    return { name: lastGuestSpeaker, method: 'last-guest', candidates, clusterVoteName };
  }
  return { name: null, method: 'unresolved', candidates, clusterVoteName };
}

/** Real turn timing from AssemblyAI word timestamps (ms relative to the audio we sent). */
function turnWindow(session: ChannelSession, data: any, now: number): { startMs: number; endMs: number; timed: boolean } {
  const words = Array.isArray(data?.words) ? data.words : [];
  const first = words[0];
  const last = words[words.length - 1];
  if (session.audioStartEpoch != null && typeof first?.start === 'number' && typeof last?.end === 'number') {
    return {
      startMs: Math.round(session.audioStartEpoch + first.start),
      endMs: Math.round(session.audioStartEpoch + last.end),
      timed: true,
    };
  }
  return { startMs: now - 3500, endMs: now, timed: false };
}

/** Insert keeping chronological order by startMs (turns from two sessions arrive interleaved). */
function insertTurnChronologically(turn: TranscriptTurn) {
  let i = finalTranscripts.length;
  while (i > 0) {
    const prev = finalTranscripts[i - 1];
    if (prev && typeof prev.startMs === 'number' && typeof turn.startMs === 'number' && prev.startMs > turn.startMs) {
      i--;
    } else {
      break;
    }
  }
  finalTranscripts.splice(i, 0, turn);
}

function broadcastTranscripts(isFinal: boolean) {
  try {
    chrome.runtime
      ?.sendMessage?.({
        type: 'TRANSCRIPT_UPDATE',
        partialTranscript: partialState,
        finalTranscripts: [...finalTranscripts],
        isFinal,
        isTabAudioCaptured,
      })
      ?.catch?.(() => {});
  } catch {}
}

function setPartial(channel: AudioChannel, partial: PartialTranscriptState | null) {
  partialByChannel[channel] = partial && partial.text ? partial : null;
  const other: AudioChannel = channel === 'mic' ? 'tab' : 'mic';
  partialState = partialByChannel[channel] ||
    partialByChannel[other] || { speaker: channel === 'mic' ? selfDisplayName() : 'Client', isSelf: channel === 'mic', text: '' };
}

// ---------------------------------------------------------------------------
// Speaker info updates from the Meet content script
// ---------------------------------------------------------------------------
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
    if (isRecording) {
      // Keep every DOM interval for the session (content script only retains 45s).
      // Open intervals are re-sent with a growing end, so overwrite by (speaker,start).
      for (const iv of newInfo.intervals) {
        if (iv) logDomIntervals.set(`${iv.speaker}|${iv.start}`, { ...iv });
      }
    }
  }

  if (speakerInfo.activeSpeaker && !isSelfName(speakerInfo.activeSpeaker)) {
    lastGuestSpeaker = speakerInfo.activeSpeaker;
  } else if (!lastGuestSpeaker && speakerInfo.guests.length === 1) {
    lastGuestSpeaker = speakerInfo.guests[0] ?? null;
  }

  // Retroactive correction: DOM intervals for recent speech may arrive after the turn
  // was emitted. Re-resolve still-unnamed remote turns from the last 6 seconds.
  const now = Date.now();
  let updatedAnyTurn = false;

  finalTranscripts = finalTranscripts.map((turn) => {
    if (turn.isSelf || turn.systemNotice || !isPlaceholder(turn.speaker)) return turn;
    const turnEnd = turn.endMs || now;
    const turnStart = turn.startMs || turnEnd - 3000;
    if (now - turnEnd >= 6000) return turn;

    const attribution = attributeTabSpeech(turnStart, turnEnd, turn.cluster || null);
    if (attribution.name) {
      updatedAnyTurn = true;
      if (turn.cluster && attribution.method === 'dom-overlap' && attribution.candidates[0]) {
        addClusterVote(turn.cluster, attribution.name, attribution.candidates[0].overlapMs);
      }
      const entry = logTurns.find((t) => t.turnId === turn.id);
      if (entry) entry.retroResolved = { name: attribution.name, method: attribution.method, at: now };
      return { ...turn, speaker: displayName(attribution.name) };
    }
    return turn;
  });

  const tabPartial = partialByChannel.tab;
  if (tabPartial && isPlaceholder(tabPartial.speaker)) {
    const attribution = attributeTabSpeech(now - 2000, now, null);
    if (attribution.name) {
      setPartial('tab', { ...tabPartial, speaker: displayName(attribution.name) });
      updatedAnyTurn = true;
    }
  }

  if (updatedAnyTurn) broadcastTranscripts(false);
}

// Poll Google Meet content script for active speaker & participant names via Background SW
function refreshSpeakerInfo() {
  if (!targetTabId) return;
  try {
    chrome.runtime?.sendMessage?.({ type: 'POLL_SPEAKER_INFO', targetTabId }, (res: any) => {
      if (chrome.runtime?.lastError) return;
      if (res?.success && res?.speakerInfo) applySpeakerInfoUpdate(res.speakerInfo);
    });
  } catch (err) {
    console.warn('[Offscreen] Error polling speaker info via background:', err);
  }
}

// ---------------------------------------------------------------------------
// Turn handling
// ---------------------------------------------------------------------------
function handleTurn(session: ChannelSession, data: any) {
  const text = String(data.transcript || '').trim();
  if (!text) return;

  const channel = session.channel;
  const isEndOfTurn = !!data.end_of_turn;
  const detectedLang = data.language_code ? String(data.language_code).toLowerCase() : null;

  if ((detectedLang && detectedLang !== 'en') || !isEnglishTranscript(text)) {
    console.log(`[Offscreen] Dropped non-English ${channel} turn (lang=${detectedLang || 'non-Latin'}): "${text}"`);
    if (!isEndOfTurn) {
      setPartial(channel, null);
      broadcastTranscripts(false);
    }
    return;
  }

  const now = Date.now();
  const { startMs, endMs, timed } = turnWindow(session, data, now);
  const cluster = channel === 'tab' && data.speaker_label ? String(data.speaker_label) : null;
  const turnOrder = typeof data.turn_order === 'number' ? data.turn_order : undefined;

  if (channel === 'mic') {
    const speaker = selfDisplayName();
    const micRms = timed ? meanEnergy('mic', startMs, endMs) : null;
    const tabRms = timed ? meanEnergy('tab', startMs, endMs) : null;
    const isBleed = micRms != null && tabRms != null && tabRms > MIC_BLEED_RATIO * micRms;

    if (!isEndOfTurn) {
      setPartial('mic', isBleed ? null : { speaker, isSelf: true, text });
      broadcastTranscripts(false);
      return;
    }

    const turnId = `turn_mic_${now}_${Math.random().toString(36).substring(2, 7)}`;
    logTurns.push({
      turnId,
      channel,
      text,
      startMs,
      endMs,
      timed,
      emittedAt: now,
      assigned: speaker,
      method: isBleed ? 'dropped-mic-bleed' : 'mic-channel',
      cluster: null,
      speakerConfidence: null,
      domCandidates: domCandidates(startMs, endMs),
      clusterVoteName: null,
      activeSpeakerAtEmit: speakerInfo.activeSpeaker,
      guests: [...speakerInfo.guests],
      micRms,
      tabRms,
      finalSpeaker: null,
      trueSpeaker: null,
    });

    setPartial('mic', null);
    if (isBleed) {
      console.log(`[Offscreen] Dropped mic turn as likely speaker bleed (mic=${micRms?.toFixed(4)}, tab=${tabRms?.toFixed(4)}): "${text}"`);
      broadcastTranscripts(false);
      return;
    }

    insertTurnChronologically({
      id: turnId,
      speaker,
      isSelf: true,
      text,
      timestamp: new Date(startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      startMs,
      endMs,
      channel,
      turnOrder,
    });
    broadcastTranscripts(true);
    return;
  }

  // Remote participants (tab channel)
  const attribution = attributeTabSpeech(startMs, endMs, cluster);
  const speaker = displayName(attribution.name || 'Client');

  if (!isEndOfTurn) {
    setPartial('tab', { speaker, isSelf: false, text });
    broadcastTranscripts(false);
    return;
  }

  if (attribution.name) {
    lastGuestSpeaker = attribution.name;
    if (cluster && attribution.method === 'dom-overlap' && attribution.candidates[0]) {
      addClusterVote(cluster, attribution.name, attribution.candidates[0].overlapMs);
    }
  }

  const turnId = `turn_tab_${now}_${Math.random().toString(36).substring(2, 7)}`;
  logTurns.push({
    turnId,
    channel,
    text,
    startMs,
    endMs,
    timed,
    emittedAt: now,
    assigned: speaker,
    method: attribution.method,
    cluster,
    speakerConfidence: typeof data.speaker_confidence === 'number' ? data.speaker_confidence : null,
    domCandidates: attribution.candidates,
    clusterVoteName: attribution.clusterVoteName,
    activeSpeakerAtEmit: speakerInfo.activeSpeaker,
    guests: [...speakerInfo.guests],
    micRms: timed ? meanEnergy('mic', startMs, endMs) : null,
    tabRms: timed ? meanEnergy('tab', startMs, endMs) : null,
    finalSpeaker: null,
    trueSpeaker: null,
  });

  insertTurnChronologically({
    id: turnId,
    speaker,
    isSelf: false,
    text,
    timestamp: new Date(startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    startMs,
    endMs,
    cluster: cluster || undefined,
    turnOrder,
    channel,
  });

  // Once a cluster has a name, upgrade its earlier unnamed turns.
  const leader = clusterLeader(cluster);
  if (cluster && leader) {
    for (const t of finalTranscripts) {
      if (t.channel === 'tab' && t.cluster === cluster && isPlaceholder(t.speaker)) {
        t.speaker = displayName(leader);
      }
    }
  }

  setPartial('tab', null);
  broadcastTranscripts(true);
}

function handleSpeakerRevision(data: any) {
  if (!Array.isArray(data.revisions) || data.revisions.length === 0) return;
  let anyRevised = false;
  for (const rev of data.revisions) {
    const targetTurn = finalTranscripts.find((t) => t.channel === 'tab' && t.turnOrder === rev.turn_order);
    if (!targetTurn) continue;
    const newCluster = rev.speaker_label ? String(rev.speaker_label) : null;
    if (newCluster && targetTurn.cluster !== newCluster) {
      const fromSpeaker = targetTurn.speaker;
      const fromCluster = targetTurn.cluster || null;
      targetTurn.cluster = newCluster;
      const resolved = clusterLeader(newCluster);
      if (resolved) targetTurn.speaker = displayName(resolved);
      logRevisions.push({
        at: Date.now(),
        turnId: targetTurn.id,
        turnOrder: rev.turn_order,
        fromCluster,
        toCluster: newCluster,
        fromSpeaker,
        toSpeaker: targetTurn.speaker,
      });
      anyRevised = true;
    }
  }
  if (anyRevised) broadcastTranscripts(false);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
function openChannelSession(
  channel: AudioChannel,
  stream: MediaStream,
  token: string,
  host: string,
  sampleRate: number
): ChannelSession {
  const params = new URLSearchParams({
    token,
    sample_rate: String(sampleRate),
    speech_model: 'universal-3-6-pro',
    language_codes: JSON.stringify(['en']),
    language_code: 'en',
    language_detection: 'true',
  });
  if (channel === 'tab') {
    // Diarization only where there can be more than one speaker.
    params.set('speaker_labels', 'true');
    params.set('speaker_labels_revision_interval_ms', '300000');
  }

  const session: ChannelSession = {
    channel,
    socket: new WebSocket(`wss://${host}/v3/ws?${params.toString()}`),
    processor: null,
    source: null,
    stream,
    audioStartEpoch: null,
  };
  const socket = session.socket!;

  socket.onopen = () => {
    console.log(`[Offscreen] ${channel} session connected to AssemblyAI Streaming v3 on ${host}`);
    if (!audioContext) return;

    const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(processor);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      recordEnergy(channel, rmsOf(input));
      if (socket.readyState === WebSocket.OPEN) {
        if (session.audioStartEpoch == null) {
          // t=0 of this stream is the first sample of the first buffer we send.
          session.audioStartEpoch = Date.now() - (input.length / sampleRate) * 1000;
          logSessions.push({ channel, startedAt: Date.now(), audioStartEpoch: Math.round(session.audioStartEpoch) });
        }
        socket.send(floatTo16BitPCM(input));
      }
      // Processor must be connected to keep running; output silence so nothing is played back.
      e.outputBuffer.getChannelData(0).fill(0);
    };

    processor.connect(audioContext.destination);
    session.processor = processor;
    session.source = source;

    if (channel === 'mic') {
      chrome.runtime?.sendMessage?.({ type: 'RECORDING_STARTED', isTabAudioCaptured });
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'Turn') handleTurn(session, data);
      else if (data.type === 'SpeakerRevision' && channel === 'tab') handleSpeakerRevision(data);
      else if (data.type === 'Termination') console.log(`[Offscreen] ${channel} session terminated cleanly`);
    } catch (parseError) {
      console.error(`[Offscreen] Error parsing ${channel} WebSocket message:`, parseError);
    }
  };

  socket.onerror = (err) => {
    console.error(`[Offscreen] AssemblyAI ${channel} WebSocket error:`, err);
    chrome.runtime?.sendMessage?.({
      type: 'RECORDING_ERROR',
      error: `WebSocket connection error with AssemblyAI (${channel === 'mic' ? 'microphone' : 'meeting audio'})`,
    });
    stopRecording();
  };

  socket.onclose = (event) => {
    console.log(`[Offscreen] ${channel} WebSocket closed: code ${event.code}, reason: ${event.reason}`);
    if (isRecording) stopRecording();
  };

  return session;
}

function closeChannelSession(session: ChannelSession | null) {
  if (!session) return;
  session.processor?.disconnect();
  session.source?.disconnect();
  const socket = session.socket;
  if (socket) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'Terminate' }));
    }
    setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }, 500);
  }
}

function cleanupAudio() {
  if (speakerPollInterval) {
    clearInterval(speakerPollInterval);
    speakerPollInterval = null;
  }
  if (tabPlaybackSource) {
    tabPlaybackSource.disconnect();
    tabPlaybackSource = null;
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
  energyHistory.mic = [];
  energyHistory.tab = [];
  isRecording = false;
  isTabAudioCaptured = false;
}

async function stopRecording() {
  if (isStopping) return;
  if (!isRecording && !micSession && !tabSession) return;
  isStopping = true;
  isRecording = false;

  closeChannelSession(micSession);
  closeChannelSession(tabSession);
  micSession = null;
  tabSession = null;

  cleanupAudio();
  persistAttributionLog();

  try {
    chrome.runtime?.sendMessage?.({ type: 'RECORDING_STOPPED', finalTranscripts });
  } catch (err) {
    console.warn('[Offscreen] Could not broadcast RECORDING_STOPPED:', err);
  }
  isStopping = false;
}

async function startOffscreenRecording(
  streamId?: string,
  token?: string,
  micToken?: string,
  initialTranscripts: any[] = [],
  meetTabId?: number,
  wsHost: string = 'streaming.assemblyai.com'
) {
  if (!token) {
    throw new Error('No AssemblyAI streaming token provided to offscreen recorder.');
  }
  if (streamId && !micToken) {
    throw new Error('A second streaming token is required to transcribe the microphone and meeting audio separately.');
  }

  isRecording = true;
  targetTabId = meetTabId || null;
  partialByChannel.mic = null;
  partialByChannel.tab = null;
  partialState = { speaker: 'You', isSelf: true, text: '' };
  clusterVotes = {}; // AssemblyAI cluster labels are per session

  // Establish initial participant baseline so existing attendees don't trigger "joined" tags
  sessionAnnouncedJoins.clear();
  for (const g of speakerInfo?.guests || []) {
    if (g) sessionAnnouncedJoins.add(g.toLowerCase());
  }

  finalTranscripts = Array.isArray(initialTranscripts)
    ? initialTranscripts.map((item, idx) =>
        typeof item === 'string'
          ? { id: `legacy_${idx}`, speaker: 'Participant', isSelf: false, text: item, timestamp: '' }
          : item
      )
    : [];

  // Poll Google Meet tab for participant names every 500ms
  refreshSpeakerInfo();
  speakerPollInterval = setInterval(refreshSpeakerInfo, 500);

  // 1. Google Meet tab audio (remote participants)
  if (streamId) {
    const tabConstraint = {
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
    } as unknown as MediaTrackConstraints;
    try {
      try {
        tabStream = await navigator.mediaDevices.getUserMedia({ audio: tabConstraint, video: tabConstraint });
        tabStream.getVideoTracks().forEach((track) => track.stop());
      } catch (errWithVideo) {
        console.warn('[Offscreen] getUserMedia with video+audio constraints failed, retrying audio-only:', errWithVideo);
        tabStream = await navigator.mediaDevices.getUserMedia({ audio: tabConstraint });
      }
      isTabAudioCaptured = true;
      console.log('[Offscreen] Captured Google Meet tab audio successfully.');
    } catch (tabErr) {
      console.error('[Offscreen] Failed to acquire Google Meet tab audio in offscreen document:', tabErr);
      isTabAudioCaptured = false;
    }
  }

  // 2. Microphone (local user)
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (micErr) {
    console.error('[Offscreen] Failed to acquire microphone in offscreen document:', micErr);
    throw micErr;
  }

  // 3. Audio graph
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  audioContext = new AudioCtx();
  if (audioContext.state === 'suspended') await audioContext.resume();
  const sampleRate = audioContext.sampleRate;

  if (tabStream) {
    // Tab capture mutes the tab, so play the meeting audio back to the user.
    tabPlaybackSource = audioContext.createMediaStreamSource(tabStream);
    tabPlaybackSource.connect(audioContext.destination);
  }

  // 4. One AssemblyAI session per source (temporary tokens are single-session,
  // so the tab session uses `token` and the mic session uses `micToken`).
  const host = wsHost || 'streaming.assemblyai.com';
  if (tabStream && micToken) {
    tabSession = openChannelSession('tab', tabStream, token, host, sampleRate);
    micSession = openChannelSession('mic', micStream, micToken, host, sampleRate);
  } else {
    micSession = openChannelSession('mic', micStream, micToken || token, host, sampleRate);
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
  if (message.type === 'START_OFFSCREEN_RECORDING') {
    startOffscreenRecording(
      message.streamId,
      message.token,
      message.micToken,
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

  if (message.type === 'GET_ATTRIBUTION_LOG') {
    sendResponse({ success: true, log: buildAttributionExport() });
    return true;
  }

  if (message.type === 'CLEAR_TRANSCRIPTS') {
    finalTranscripts = [];
    partialByChannel.mic = null;
    partialByChannel.tab = null;
    partialState = { speaker: 'You', isSelf: true, text: '' };
    clusterVotes = {};
    resetAttributionLog();
    chrome.storage?.local?.remove?.('attributionLog');
    sessionAnnouncedJoins.clear();
    for (const g of speakerInfo?.guests || []) {
      if (g) sessionAnnouncedJoins.add(g.toLowerCase());
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SPEAKER_INFO_DISPATCH' || message.type === 'SPEAKER_INFO_UPDATED') {
    if (message.speakerInfo) applySpeakerInfoUpdate(message.speakerInfo);
    return false;
  }

  if (message.type === 'PARTICIPANTS_JOINED') {
    const joined = Array.isArray(message.joined) ? message.joined : [message.name];
    if (isRecording) {
      let anyAdded = false;
      for (const name of joined) {
        if (!name || isSelfName(name)) continue;
        const lower = name.toLowerCase();
        logRosterEvents.push({ at: Date.now(), type: 'joined', name });
        if (sessionAnnouncedJoins.has(lower)) continue;
        sessionAnnouncedJoins.add(lower);
        anyAdded = true;
        const at = Date.now();
        insertTurnChronologically({
          id: `sys_join_${at}_${Math.random().toString(36).substring(2, 6)}`,
          speaker: 'System',
          isSelf: false,
          text: `${name} joined the meeting`,
          timestamp: new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          startMs: at,
          endMs: at,
          systemNotice: true,
        });
      }
      if (anyAdded) broadcastTranscripts(true);
    }
    return false;
  }

  if (message.type === 'PARTICIPANTS_LEFT') {
    const left = Array.isArray(message.left) ? message.left : [message.name];
    if (isRecording) {
      let anyLeft = false;
      for (const name of left) {
        if (!name || isSelfName(name)) continue;
        const lower = name.toLowerCase();
        logRosterEvents.push({ at: Date.now(), type: 'left', name });
        sessionAnnouncedJoins.delete(lower);
        if (lastGuestSpeaker?.toLowerCase() === lower) lastGuestSpeaker = null;
        anyLeft = true;
        const at = Date.now();
        insertTurnChronologically({
          id: `sys_leave_${at}_${Math.random().toString(36).substring(2, 6)}`,
          speaker: 'System',
          isSelf: false,
          text: `${name} left the meeting`,
          timestamp: new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          startMs: at,
          endMs: at,
          systemNotice: true,
        });
      }
      if (anyLeft) broadcastTranscripts(true);
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
          } else if (!originalName && (isPlaceholder(turn.speaker) || turn.speaker === lastGuestSpeaker)) {
            return { ...turn, speaker: newName };
          }
        }
        return turn;
      });

      const tabPartial = partialByChannel.tab;
      if (tabPartial && (!originalName || tabPartial.speaker === originalName)) {
        setPartial('tab', { ...tabPartial, speaker: newName });
      }

      broadcastTranscripts(false);
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

console.log('[Offscreen] MeetAnalyze offscreen recorder loaded (separate mic/tab sessions, attribution logging).');
