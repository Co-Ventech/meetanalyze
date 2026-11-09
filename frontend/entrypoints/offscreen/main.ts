import type { TranscriptTurn, PartialTranscriptState, SpeakerInfo, SpeakerInterval } from '../common/types';

declare const chrome: any;

/**
 * Offscreen audio recorder with channel-separated speaker attribution.
 *
 * - Microphone audio  -> its own AssemblyAI stream -> every turn is the local user.
 * - Meet tab audio    -> its own AssemblyAI stream (with diarization) -> every turn is a remote
 *   participant, named via the Meet caption speaker timeline captured by the content script.
 *
 * Splitting the channels (instead of mixing them and guessing by volume) is what makes
 * "me vs others" deterministic.
 */

type StreamKind = 'mic' | 'tab';

interface StreamCtx {
  kind: StreamKind;
  socket: WebSocket | null;
  processor: ScriptProcessorNode | null;
  // Wall-clock time (epoch ms) corresponding to audio t=0 of this AssemblyAI session
  audioStartWallMs: number | null;
  partial: PartialTranscriptState | null;
  partialUpdatedAt: number;
  partialCluster: string | null;
}

interface EnergySample {
  t: number;
  mic: number;
  tab: number;
}

let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let tabStream: MediaStream | null = null;
let micAnalyser: AnalyserNode | null = null;
let tabAnalyser: AnalyserNode | null = null;
let speakerPollInterval: any = null;
let energyInterval: any = null;

let micCtx: StreamCtx | null = null;
let tabCtx: StreamCtx | null = null;

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
let guestOverrides: Record<string, string> = {};
let clusterToNameMap: Record<string, string> = {};
let sessionAnnouncedJoins = new Set<string>();

let energySamples: EnergySample[] = [];

let partialState: PartialTranscriptState | null = null;
let finalTranscripts: TranscriptTurn[] = [];

const ENERGY_THRESHOLD = 0.015;
const RETRO_WINDOW_MS = 30000;
const ECHO_CHECK_DELAY_MS = 1800;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Helper to verify that text is in the English / Latin alphabet
// Rejects foreign alphabets (Arabic, Urdu, Cyrillic, Devanagari, CJK, Hebrew, etc.)
function isEnglishTranscript(text: string): boolean {
  if (!text || !text.trim()) return false;

  const nonLatinRegex = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿ऀ-ॿЀ-ӿ一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯֐-׿฀-๿Ͱ-Ͽ]/;
  if (nonLatinRegex.test(text)) {
    return false;
  }

  if (!/[a-zA-Z0-9]/.test(text)) {
    return false;
  }

  return true;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2)
  );
}

function jaccard(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function isSelfName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower === 'you' || lower === speakerInfo.selfName.toLowerCase();
}

function selfDisplayName(): string {
  return speakerInfo.selfName && speakerInfo.selfName.toLowerCase() !== 'you'
    ? `${speakerInfo.selfName} (You)`
    : 'You';
}

// AssemblyAI sends temporary labels ("PENDING" while it is still deciding, "UNKNOWN" when it
// can't tell) that are NOT voices. Treat them as "no cluster yet"; a later SpeakerRevision
// supplies the real label and the turn is re-attributed then.
const NON_CLUSTER_LABELS = new Set(['PENDING', 'UNKNOWN', 'NONE', 'NULL', '']);

function normalizeCluster(label: unknown): string | null {
  if (label === null || label === undefined) return null;
  const value = String(label).trim();
  return NON_CLUSTER_LABELS.has(value.toUpperCase()) ? null : value;
}

const UNKNOWN_SPEAKER = 'Unknown speaker';

function placeholderName(cluster: string | null | undefined): string {
  return cluster ? `Speaker ${cluster}` : UNKNOWN_SPEAKER;
}

function isPlaceholderName(name: string): boolean {
  return (
    name === UNKNOWN_SPEAKER ||
    name === 'Client' ||
    name === 'Guest' ||
    /^Speaker [A-Za-z0-9]+$/.test(name)
  );
}

function applyOverride(name: string): string {
  return guestOverrides[name] || name;
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Pick the remote speaker whose intervals overlap [start, end] the most.
 * Returns the name and the fraction of the turn covered by that speaker.
 */
function bestRemoteOverlap(
  start: number,
  end: number,
  source: 'captions' | 'active'
): { speaker: string; ratio: number } | null {
  const duration = Math.max(1, end - start);
  const totals = new Map<string, number>();

  for (const iv of speakerIntervals) {
    const ivSource = iv.source || 'active';
    if (ivSource !== source) continue;
    if (iv.isSelf || isSelfName(iv.speaker)) continue;
    const ov = overlapMs(start, end, iv.start, iv.end);
    if (ov > 0) totals.set(iv.speaker, (totals.get(iv.speaker) || 0) + ov);
  }

  let best: { speaker: string; ratio: number } | null = null;
  for (const [speaker, total] of totals) {
    const ratio = Math.min(1, total / duration);
    if (!best || ratio > best.ratio) best = { speaker, ratio };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Evidence-based remote speaker attribution
//
// Each remote turn stores its OWN evidence for who spoke it (caption overlap, "only guest present
// at that moment", manual rename, Google Meet transcript). A cluster's name is a weighted vote over
// the evidence of its turns, recomputed whenever anything changes. Nothing is bound permanently, so
// a late joiner or an AssemblyAI cluster revision can't corrupt names that already had evidence.
// ---------------------------------------------------------------------------

type EvidenceSource = NonNullable<TranscriptTurn['evidenceSource']>;

const EVIDENCE_WEIGHT: Record<EvidenceSource, number> = {
  manual: 100,
  'meet-api': 20,
  captions: 3,
  'single-guest': 1,
};

// Identifies the current recording session; AssemblyAI cluster letters and turn_order values
// are only meaningful within one session, so turns from earlier sessions are never relabelled.
let sessionId = '';

// Guest roster history: when each remote participant was first seen during this session
let rosterFirstSeen = new Map<string, { name: string; firstSeen: number }>();
let rosterBaselined = false;
let rosterGrowthTimes: number[] = [];
// Clusters whose name came from elimination (one unnamed voice + one unmatched guest)
let eliminationClusters = new Set<string>();

function isCurrentSessionRemote(t: TranscriptTurn): boolean {
  return !t.isSelf && !t.systemNotice && t.sessionId === sessionId;
}

function updateRoster(guests: string[]): number | null {
  const now = Date.now();
  let grewAt: number | null = null;
  for (const g of guests) {
    if (!g) continue;
    const key = g.toLowerCase();
    if (rosterFirstSeen.has(key)) continue;
    // Guests already in the call when recording started count as present from the beginning
    rosterFirstSeen.set(key, { name: g, firstSeen: rosterBaselined ? now : 0 });
    if (rosterBaselined) grewAt = now;
  }
  rosterBaselined = true;
  return grewAt;
}

function guestsPresentAt(t: number): string[] {
  return speakerInfo.guests.filter((g) => {
    const entry = rosterFirstSeen.get(g.toLowerCase());
    return !entry || entry.firstSeen <= t;
  });
}

/** Direct evidence for a single turn, independent of its cluster. */
function computeEvidence(startMs: number, endMs: number): { name: string; source: EvidenceSource } | null {
  // Allow ~1s slack at the end since captions lag the audio slightly
  const caption = bestRemoteOverlap(startMs, endMs + 1000, 'captions');
  if (caption && caption.ratio >= 0.5) return { name: caption.speaker, source: 'captions' };

  const present = guestsPresentAt(startMs);
  if (present.length === 1 && present[0]) return { name: present[0], source: 'single-guest' };

  return null;
}

/** Weaker per-turn hint used only when there is no evidence and no cluster binding. */
function computeWeakHint(startMs: number, endMs: number): { name: string; by: TranscriptTurn['resolvedBy'] } | null {
  const caption = bestRemoteOverlap(startMs, endMs + 1000, 'captions');
  if (caption && caption.ratio > 0) return { name: caption.speaker, by: 'captions' };
  const active = bestRemoteOverlap(startMs, endMs + 1000, 'active');
  if (active && active.ratio >= 0.3) return { name: active.speaker, by: 'active-speaker' };
  return null;
}

/**
 * Meet's participant list lags a join by a few seconds, so a new person's first words can be
 * credited to the previous sole guest. For every roster growth, single-guest evidence in the
 * 30s before it is kept only on that guest's main voice cluster; other clusters lose it.
 * Re-run on every relabel so AssemblyAI cluster revisions are covered too.
 */
function invalidateLaggedSingleGuestEvidence() {
  if (rosterGrowthTimes.length === 0) return;

  // Main cluster per guest = cluster with the most single-guest evidence for them
  const counts = new Map<string, Map<string, number>>();
  for (const t of finalTranscripts) {
    if (!isCurrentSessionRemote(t) || t.evidenceSource !== 'single-guest' || !t.evidenceName || !t.cluster) continue;
    const c = counts.get(t.evidenceName) || new Map<string, number>();
    c.set(t.cluster, (c.get(t.cluster) || 0) + 1);
    counts.set(t.evidenceName, c);
  }
  const mainCluster = new Map<string, string>();
  for (const [guest, c] of counts) {
    const top = Array.from(c.entries()).sort((a, b) => b[1] - a[1])[0];
    if (top) mainCluster.set(guest, top[0]);
  }

  for (const t of finalTranscripts) {
    if (!isCurrentSessionRemote(t) || t.evidenceSource !== 'single-guest' || !t.evidenceName) continue;
    const start = t.startMs ?? 0;
    if (!t.cluster) {
      // No voice cluster to compare against: only distrust turns right before the join was seen
      if (rosterGrowthTimes.some((g) => start >= g - 5000 && start <= g)) {
        t.evidenceName = undefined;
        t.evidenceSource = undefined;
      }
      continue;
    }
    const inLagWindow = rosterGrowthTimes.some((g) => start >= g - 30000 && start <= g);
    if (!inLagWindow) continue;
    if (t.cluster !== mainCluster.get(t.evidenceName)) {
      t.evidenceName = undefined;
      t.evidenceSource = undefined;
    }
  }
}

/** Recompute cluster -> name bindings from the evidence of current-session turns. */
function computeBindings() {
  const votes = new Map<string, Map<string, number>>();
  const clustersSeen = new Set<string>();

  for (const t of finalTranscripts) {
    if (!isCurrentSessionRemote(t) || !t.cluster) continue;
    clustersSeen.add(t.cluster);
    if (!t.evidenceName || !t.evidenceSource) continue;
    const v = votes.get(t.cluster) || new Map<string, number>();
    v.set(t.evidenceName, (v.get(t.evidenceName) || 0) + EVIDENCE_WEIGHT[t.evidenceSource]);
    votes.set(t.cluster, v);
  }

  const next: Record<string, string> = {};
  for (const [cluster, v] of votes) {
    const ranked = Array.from(v.entries()).sort((a, b) => b[1] - a[1]);
    const [leader, leaderScore] = ranked[0] || ['', 0];
    if (!leader) continue;
    const prior = eliminationClusters.has(cluster) ? undefined : clusterToNameMap[cluster];
    const priorScore = prior ? v.get(prior) || 0 : 0;
    // Hysteresis: only switch an existing binding when the new name clearly wins
    next[cluster] = prior && prior !== leader && priorScore > 0 && leaderScore < priorScore + 2 ? prior : leader;
  }

  // Elimination: exactly one unnamed voice and exactly one guest without a voice -> they match
  eliminationClusters = new Set();
  const boundNames = new Set(Object.values(next).map((n) => n.toLowerCase()));
  const unboundClusters = Array.from(clustersSeen).filter((c) => !next[c]);
  const unboundGuests = speakerInfo.guests.filter((g) => g && !boundNames.has(g.toLowerCase()));
  if (unboundClusters.length === 1 && unboundGuests.length === 1) {
    next[unboundClusters[0]!] = unboundGuests[0]!;
    eliminationClusters.add(unboundClusters[0]!);
  }

  clusterToNameMap = next;
}

interface Attribution {
  name: string;
  unresolved: boolean;
  resolvedBy?: TranscriptTurn['resolvedBy'];
}

function attributeTurn(t: TranscriptTurn): Attribution {
  // Direct, strong per-turn evidence always wins for that turn
  if (t.evidenceName && (t.evidenceSource === 'manual' || t.evidenceSource === 'meet-api')) {
    return { name: t.evidenceName, unresolved: false, resolvedBy: t.evidenceSource };
  }
  if (t.evidenceName && t.evidenceSource === 'captions') {
    return { name: t.evidenceName, unresolved: false, resolvedBy: 'captions' };
  }
  if (t.cluster && clusterToNameMap[t.cluster]) {
    return {
      name: clusterToNameMap[t.cluster]!,
      unresolved: false,
      resolvedBy: eliminationClusters.has(t.cluster) ? 'elimination' : 'cluster',
    };
  }
  if (t.evidenceName) {
    return { name: t.evidenceName, unresolved: false, resolvedBy: 'single-guest' };
  }
  if (t.weakName) {
    return { name: t.weakName, unresolved: false, resolvedBy: t.weakBy };
  }
  return { name: placeholderName(t.cluster), unresolved: true };
}

/** Re-derive display labels for every current-session remote turn. Returns true if anything changed. */
function relabelAll(): boolean {
  invalidateLaggedSingleGuestEvidence();
  computeBindings();
  let changed = false;
  for (const t of finalTranscripts) {
    if (!isCurrentSessionRemote(t)) continue;
    const a = attributeTurn(t);
    const display = a.resolvedBy === 'manual' ? a.name : applyOverride(a.name);
    if (t.speaker !== display || !!t.unresolved !== a.unresolved || t.resolvedBy !== a.resolvedBy) {
      t.speaker = display;
      t.unresolved = a.unresolved || undefined;
      t.resolvedBy = a.resolvedBy;
      changed = true;
    }
  }
  return changed;
}

/** Live label for an in-progress (partial) remote turn. */
function labelForPartial(startMs: number, endMs: number, cluster: string | null): string {
  if (cluster && clusterToNameMap[cluster]) return applyOverride(clusterToNameMap[cluster]!);
  const evidence = computeEvidence(startMs, endMs);
  if (evidence) return applyOverride(evidence.name);
  const hint = computeWeakHint(startMs, endMs);
  if (hint) return applyOverride(hint.name);
  return placeholderName(cluster);
}

// Insert a turn keeping finalTranscripts ordered by start time
function insertTurn(turn: TranscriptTurn) {
  const key = turn.startMs ?? Date.now();
  let idx = finalTranscripts.length;
  while (idx > 0) {
    const prev = finalTranscripts[idx - 1];
    const prevKey = prev?.startMs ?? -Infinity;
    if (prevKey <= key) break;
    idx--;
  }
  finalTranscripts.splice(idx, 0, turn);
}

function broadcastUpdate(isFinal: boolean) {
  chrome.runtime?.sendMessage?.({
    type: 'TRANSCRIPT_UPDATE',
    partialTranscript: partialState,
    finalTranscripts: [...finalTranscripts],
    isFinal,
    isTabAudioCaptured,
  })?.catch?.(() => {});
}

// Show the most recently updated non-empty partial from either stream
function refreshPartialState() {
  const candidates = [micCtx?.partial, tabCtx?.partial]
    .map((p, i) => ({ p, at: i === 0 ? micCtx?.partialUpdatedAt || 0 : tabCtx?.partialUpdatedAt || 0 }))
    .filter((c) => c.p && c.p.text);
  candidates.sort((a, b) => b.at - a.at);
  partialState = candidates[0]?.p ?? null;
}

// ---------------------------------------------------------------------------
// Echo guard (laptop speakers without headphones)
// ---------------------------------------------------------------------------

function tabDominanceRatio(startMs: number, endMs: number): number {
  let total = 0;
  let tabDominant = 0;
  for (const s of energySamples) {
    if (s.t < startMs || s.t > endMs) continue;
    if (s.mic < ENERGY_THRESHOLD && s.tab < ENERGY_THRESHOLD) continue;
    total++;
    if (s.tab > ENERGY_THRESHOLD && s.tab > s.mic * 1.05) tabDominant++;
  }
  return total === 0 ? 0 : tabDominant / total;
}

function isLikelyEcho(turn: TranscriptTurn): boolean {
  if (!isTabAudioCaptured || turn.startMs === undefined || turn.endMs === undefined) return false;
  const ratio = tabDominanceRatio(turn.startMs, turn.endMs);
  if (ratio <= 0.6) return false;

  const slack = 2000;
  const overlappingRemote = finalTranscripts.filter(
    (t) =>
      !t.isSelf &&
      !t.systemNotice &&
      overlapMs(turn.startMs! - slack, turn.endMs! + slack, t.startMs ?? 0, t.endMs ?? 0) > 0
  );
  const texts = overlappingRemote.map((t) => t.text);
  if (tabCtx?.partial?.text) texts.push(tabCtx.partial.text);
  return texts.some((txt) => jaccard(turn.text, txt) > 0.6);
}

function scheduleEchoCheck(turnId: string) {
  setTimeout(() => {
    const idx = finalTranscripts.findIndex((t) => t.id === turnId);
    if (idx === -1) return;
    const turn = finalTranscripts[idx]!;
    if (isLikelyEcho(turn)) {
      console.log(`[Offscreen] Dropped echoed mic turn: "${turn.text}"`);
      finalTranscripts.splice(idx, 1);
      broadcastUpdate(false);
    }
  }, ECHO_CHECK_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Speaker info from the Meet tab
// ---------------------------------------------------------------------------

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

  if (Array.isArray(newInfo.intervals)) {
    speakerIntervals = newInfo.intervals;
  }

  if (!isRecording) return;

  // Track when each guest first appeared; a new guest invalidates lagged single-guest evidence
  const grewAt = updateRoster(speakerInfo.guests);
  if (grewAt !== null) rosterGrowthTimes.push(grewAt);

  // Retroactive evidence: captions lag the audio, so re-check recent turns that lack evidence
  const now = Date.now();
  for (const turn of finalTranscripts) {
    if (!isCurrentSessionRemote(turn) || turn.evidenceSource) continue;
    const turnEnd = turn.endMs ?? now;
    if (now - turnEnd > RETRO_WINDOW_MS) continue;
    const turnStart = turn.startMs ?? turnEnd - 3000;
    const evidence = computeEvidence(turnStart, turnEnd);
    if (evidence) {
      turn.evidenceName = evidence.name;
      turn.evidenceSource = evidence.source;
    } else if (!turn.weakName) {
      const hint = computeWeakHint(turnStart, turnEnd);
      if (hint) {
        turn.weakName = hint.name;
        turn.weakBy = hint.by as TranscriptTurn['weakBy'];
      }
    }
  }

  let updatedAnyTurn = relabelAll();

  // Upgrade the remote partial label too
  if (tabCtx?.partial && tabCtx.partial.text && isPlaceholderName(tabCtx.partial.speaker)) {
    const label = labelForPartial(now - 2500, now, tabCtx.partialCluster);
    if (label !== tabCtx.partial.speaker) {
      tabCtx.partial = { ...tabCtx.partial, speaker: label };
      refreshPartialState();
      updatedAnyTurn = true;
    }
  }

  if (updatedAnyTurn) {
    broadcastUpdate(false);
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

// ---------------------------------------------------------------------------
// AssemblyAI streams
// ---------------------------------------------------------------------------

function buildWsUrl(host: string, token: string, sampleRate: number, diarize: boolean): string {
  const encodedLangCodes = encodeURIComponent(JSON.stringify(['en']));
  let url =
    `wss://${host}/v3/ws?token=${encodeURIComponent(token)}&sample_rate=${sampleRate}` +
    `&speech_model=universal-3-6-pro&language_codes=${encodedLangCodes}&language_code=en&language_detection=true`;
  if (diarize) {
    url += '&speaker_labels=true&speaker_labels_revision_interval_ms=300000';
  }
  return url;
}

function getTurnWindow(ctx: StreamCtx, data: any): { startMs: number; endMs: number } {
  const now = Date.now();
  const words = Array.isArray(data.words) ? data.words : [];
  const first = words[0];
  const last = words[words.length - 1];
  if (ctx.audioStartWallMs !== null && first && last && typeof first.start === 'number' && typeof last.end === 'number') {
    return {
      startMs: ctx.audioStartWallMs + first.start,
      endMs: ctx.audioStartWallMs + last.end,
    };
  }
  return { startMs: now - 3000, endMs: now };
}

function handleTurn(ctx: StreamCtx, data: any) {
  const text: string = (data.transcript || '').trim();
  const isEndOfTurn = !!data.end_of_turn;
  const cluster = normalizeCluster(data.speaker_label);
  const turnOrder = typeof data.turn_order === 'number' ? data.turn_order : undefined;
  const detectedLang = data.language_code ? String(data.language_code).toLowerCase() : null;

  // Ignore late messages after stop (RECORDING_STOPPED already carried the final transcript)
  if (!text || !isRecording) return;

  // Strict English-only enforcement
  if ((detectedLang && detectedLang !== 'en') || !isEnglishTranscript(text)) {
    console.log(`[Offscreen] Dropped non-English ${ctx.kind} turn (lang=${detectedLang || 'non-Latin'}): "${text}"`);
    if (!isEndOfTurn) {
      ctx.partial = null;
      refreshPartialState();
      broadcastUpdate(false);
    }
    return;
  }

  const { startMs, endMs } = getTurnWindow(ctx, data);
  const isSelf = ctx.kind === 'mic';

  if (isEndOfTurn) {
    const turn: TranscriptTurn = {
      id: `turn_${ctx.kind}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      speaker: isSelf ? selfDisplayName() : placeholderName(cluster),
      isSelf,
      text,
      timestamp: new Date(startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      startMs,
      endMs,
      sessionId,
      cluster: isSelf ? undefined : cluster || undefined,
      turnOrder: isSelf ? undefined : turnOrder,
    };

    if (!isSelf) {
      const evidence = computeEvidence(startMs, endMs);
      if (evidence) {
        turn.evidenceName = evidence.name;
        turn.evidenceSource = evidence.source;
      } else {
        const hint = computeWeakHint(startMs, endMs);
        if (hint) {
          turn.weakName = hint.name;
          turn.weakBy = hint.by as TranscriptTurn['weakBy'];
        }
      }
    }

    insertTurn(turn);
    if (!isSelf) {
      relabelAll();
      logAttribution(turn);
    }
    ctx.partial = null;
    ctx.partialCluster = null;
    if (isSelf) scheduleEchoCheck(turn.id);
  } else {
    const speaker = isSelf ? selfDisplayName() : labelForPartial(startMs, endMs, cluster);
    ctx.partial = { speaker, isSelf, text };
    ctx.partialCluster = isSelf ? null : cluster;
    ctx.partialUpdatedAt = Date.now();
  }

  refreshPartialState();
  broadcastUpdate(isEndOfTurn);
}

// Diagnostics: open the offscreen document's DevTools (chrome://extensions -> Inspect views) to see these
function logAttribution(turn: TranscriptTurn) {
  const captionCount = speakerIntervals.filter((iv) => iv.source === 'captions').length;
  console.log(
    `[Attribution] "${turn.text.slice(0, 40)}" cluster=${turn.cluster ?? '-'} ` +
      `evidence=${turn.evidenceSource ?? 'none'}${turn.evidenceName ? `(${turn.evidenceName})` : ''} ` +
      `-> ${turn.speaker} via ${turn.resolvedBy ?? 'placeholder'} | guests=[${speakerInfo.guests.join(', ')}] ` +
      `captionIntervals=${captionCount} bindings=${JSON.stringify(clusterToNameMap)}`
  );
  if (captionCount === 0 && isTabAudioCaptured) {
    console.warn('[Attribution] No Meet caption speaker data received. Names rely on roster heuristics only.');
  }
}

function handleSpeakerRevision(data: any) {
  if (!Array.isArray(data.revisions) || data.revisions.length === 0) return;
  let anyRevised = false;
  for (const rev of data.revisions) {
    // turn_order is only unique within one AssemblyAI session
    const targetTurn = finalTranscripts.find((t) => isCurrentSessionRemote(t) && t.turnOrder === rev.turn_order);
    if (!targetTurn) continue;
    const newCluster = normalizeCluster(rev.speaker_label);
    if (newCluster && targetTurn.cluster !== newCluster) {
      targetTurn.cluster = newCluster;
      anyRevised = true;
    }
  }
  // Bindings are re-voted from evidence, so a revision just moves turns between clusters
  if (anyRevised && relabelAll()) broadcastUpdate(false);
}

function openStream(
  kind: StreamKind,
  source: MediaStreamAudioSourceNode,
  token: string,
  host: string,
  sampleRate: number
): StreamCtx {
  const ctx: StreamCtx = {
    kind,
    socket: null,
    processor: null,
    audioStartWallMs: null,
    partial: null,
    partialUpdatedAt: 0,
    partialCluster: null,
  };

  const socket = new WebSocket(buildWsUrl(host, token, sampleRate, kind === 'tab'));
  ctx.socket = socket;

  socket.onopen = () => {
    console.log(`[Offscreen] Connected to AssemblyAI (${kind} stream) on ${host}`);
    if (!audioContext) return;

    const processor = audioContext.createScriptProcessor(2048, 1, 1);
    ctx.processor = processor;
    source.connect(processor);

    processor.onaudioprocess = (e) => {
      if (socket.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);
        if (ctx.audioStartWallMs === null) {
          // This buffer started (bufferSize / sampleRate) seconds ago
          ctx.audioStartWallMs = Date.now() - (inputData.length / sampleRate) * 1000;
        }
        socket.send(floatTo16BitPCM(inputData));
      }
      // Zero out processor output to prevent a local feedback loop
      e.outputBuffer.getChannelData(0).fill(0);
    };

    processor.connect(audioContext.destination);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'Turn') {
        handleTurn(ctx, data);
      } else if (data.type === 'SpeakerRevision' && kind === 'tab') {
        handleSpeakerRevision(data);
      } else if (data.type === 'Termination') {
        console.log(`[Offscreen] AssemblyAI ${kind} session terminated cleanly`);
      }
    } catch (parseError) {
      console.error(`[Offscreen] Error parsing ${kind} WebSocket message:`, parseError);
    }
  };

  socket.onerror = (err) => {
    console.error(`[Offscreen] AssemblyAI ${kind} WebSocket error:`, err);
    if (kind === 'mic') {
      chrome.runtime?.sendMessage?.({
        type: 'RECORDING_ERROR',
        error: 'WebSocket connection error with AssemblyAI',
      });
      stopRecording();
    }
  };

  socket.onclose = (event) => {
    console.log(`[Offscreen] ${kind} WebSocket closed: code ${event.code}, reason: ${event.reason}`);
    if (!isRecording) return;
    if (kind === 'mic') {
      stopRecording();
    } else {
      // Tab stream lost: keep recording the mic, but remote speech is no longer transcribed
      isTabAudioCaptured = false;
      broadcastUpdate(false);
    }
  };

  return ctx;
}

function closeStream(ctx: StreamCtx | null) {
  if (!ctx) return;
  if (ctx.processor) {
    ctx.processor.disconnect();
    ctx.processor.onaudioprocess = null;
    ctx.processor = null;
  }
  const socket = ctx.socket;
  ctx.socket = null;
  if (socket) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'Terminate' }));
    }
    setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }, 500);
  }
}

function cleanupAudio() {
  if (speakerPollInterval) {
    clearInterval(speakerPollInterval);
    speakerPollInterval = null;
  }
  if (energyInterval) {
    clearInterval(energyInterval);
    energyInterval = null;
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
  energySamples = [];
  isRecording = false;
  isTabAudioCaptured = false;
}

let isStopping = false;

async function stopRecording() {
  if (isStopping) return;
  isStopping = true;
  isRecording = false;

  try {
    const micCtxLocal = micCtx;
    const tabCtxLocal = tabCtx;
    micCtx = null;
    tabCtx = null;
    closeStream(micCtxLocal);
    closeStream(tabCtxLocal);
    partialState = null;

    cleanupAudio();

    try {
      chrome.runtime?.sendMessage?.({
        type: 'RECORDING_STOPPED',
        finalTranscripts,
      });
    } catch (err) {
      console.warn('[Offscreen] Could not broadcast RECORDING_STOPPED:', err);
    }
  } finally {
    isStopping = false;
  }
}

async function startOffscreenRecording(
  streamId: string | undefined,
  micToken: string | undefined,
  tabToken: string | undefined,
  initialTranscripts: any[] = [],
  meetTabId?: number,
  wsHost: string = 'streaming.assemblyai.com'
) {
  if (!micToken) {
    throw new Error('No AssemblyAI streaming token provided to offscreen recorder.');
  }

  isRecording = true;
  targetTabId = meetTabId || null;
  partialState = null;
  clusterToNameMap = {};
  eliminationClusters = new Set();
  rosterFirstSeen = new Map();
  rosterBaselined = false;
  rosterGrowthTimes = [];
  sessionId = `s_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  energySamples = [];

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

  // Poll Google Meet tab for participant names & caption timeline every 500ms
  refreshSpeakerInfo();
  speakerPollInterval = setInterval(refreshSpeakerInfo, 500);

  // 1. Acquire Google Meet tab audio via streamId (remote participants)
  if (streamId && tabToken) {
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
      }
      isTabAudioCaptured = true;
      console.log('[Offscreen] Captured Google Meet tab audio successfully.');
    } catch (tabErr) {
      console.error('[Offscreen] Failed to acquire Google Meet tab audio in offscreen document:', tabErr);
      isTabAudioCaptured = false;
    }
  }

  // 2. Acquire microphone audio (local user)
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch (micErr) {
    console.error('[Offscreen] Failed to acquire microphone in offscreen document:', micErr);
    cleanupAudio();
    throw micErr;
  }

  // 3. Audio graph: separate sources, each with its own analyser
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  audioContext = new AudioCtx();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  const sampleRate = audioContext.sampleRate;

  micAnalyser = audioContext.createAnalyser();
  micAnalyser.fftSize = 256;
  const micSource = audioContext.createMediaStreamSource(micStream);
  micSource.connect(micAnalyser);

  let tabSource: MediaStreamAudioSourceNode | null = null;
  if (tabStream) {
    tabAnalyser = audioContext.createAnalyser();
    tabAnalyser.fftSize = 256;
    tabSource = audioContext.createMediaStreamSource(tabStream);
    tabSource.connect(tabAnalyser);
    // Route tab audio to speakers/headphones so the user still hears the meeting
    tabSource.connect(audioContext.destination);
  }

  // Energy timeline used by the echo guard
  energyInterval = setInterval(() => {
    if (!micAnalyser) return;
    const now = Date.now();
    energySamples.push({
      t: now,
      mic: getStreamVolume(micAnalyser),
      tab: tabAnalyser ? getStreamVolume(tabAnalyser) : 0,
    });
    const cutoff = now - 60000;
    while (energySamples.length > 0 && (energySamples[0]?.t ?? 0) < cutoff) {
      energySamples.shift();
    }
  }, 50);

  // 4. One AssemblyAI session per channel
  const host = wsHost || 'streaming.assemblyai.com';
  micCtx = openStream('mic', micSource, micToken, host, sampleRate);
  if (tabSource && tabToken) {
    tabCtx = openStream('tab', tabSource, tabToken, host, sampleRate);
  }

  chrome.runtime?.sendMessage?.({
    type: 'RECORDING_STARTED',
    isTabAudioCaptured,
  });
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
  if (message.type === 'START_OFFSCREEN_RECORDING') {
    startOffscreenRecording(
      message.streamId,
      message.micToken || message.token,
      message.tabToken,
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
    partialState = null;
    if (micCtx) micCtx.partial = null;
    if (tabCtx) tabCtx.partial = null;
    clusterToNameMap = {};
    eliminationClusters = new Set();
    sessionAnnouncedJoins.clear();
    if (speakerInfo?.guests) {
      for (const g of speakerInfo.guests) {
        if (g) sessionAnnouncedJoins.add(g.toLowerCase());
      }
    }
    sendResponse({ success: true });
    return true;
  }

  // Post-meeting relabel results (Google Meet REST API) -> merge by turn id
  if (message.type === 'TRANSCRIPTS_RELABELED') {
    if (Array.isArray(message.finalTranscripts)) {
      const byId = new Map<string, TranscriptTurn>(
        message.finalTranscripts.map((t: TranscriptTurn) => [t.id, t])
      );
      finalTranscripts = finalTranscripts.map((t) => {
        const updated = byId.get(t.id);
        if (!updated || t.isSelf) return t;
        return {
          ...t,
          speaker: updated.speaker,
          unresolved: updated.unresolved,
          resolvedBy: updated.resolvedBy,
          evidenceName: updated.evidenceName ?? t.evidenceName,
          evidenceSource: updated.evidenceSource ?? t.evidenceSource,
        };
      });
    }
    return false;
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
        if (!name || isSelfName(name)) continue;
        const lower = name.toLowerCase();
        if (sessionAnnouncedJoins.has(lower)) continue;
        sessionAnnouncedJoins.add(lower);
        anyAdded = true;

        const now = Date.now();
        insertTurn({
          id: `sys_join_${now}_${Math.random().toString(36).substring(2, 6)}`,
          speaker: 'System',
          isSelf: false,
          text: `${name} joined the meeting`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          startMs: now,
          endMs: now,
          systemNotice: true,
        });
      }

      if (anyAdded) broadcastUpdate(true);
    }
    return false;
  }

  // Dynamic participant left notification (strictly deduplicated)
  if (message.type === 'PARTICIPANTS_LEFT') {
    const left = Array.isArray(message.left) ? message.left : [message.name];

    if (isRecording) {
      let anyLeft = false;
      for (const name of left) {
        if (!name || isSelfName(name)) continue;
        const lower = name.toLowerCase();
        sessionAnnouncedJoins.delete(lower);
        anyLeft = true;

        const now = Date.now();
        insertTurn({
          id: `sys_leave_${now}_${Math.random().toString(36).substring(2, 6)}`,
          speaker: 'System',
          isSelf: false,
          text: `${name} left the meeting`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          startMs: now,
          endMs: now,
          systemNotice: true,
        });
      }

      if (anyLeft) broadcastUpdate(true);
    }
    return false;
  }

  // Manual guest name override from user in UI
  if (message.type === 'SET_GUEST_NAME_OFFSCREEN') {
    const originalName = message.originalName?.trim();
    const newName = message.name?.trim();

    if (newName) {
      const renamingPlaceholder = !originalName || isPlaceholderName(originalName);
      if (originalName && !renamingPlaceholder) {
        // Real Meet name corrected by the user: display-level alias
        guestOverrides[originalName] = newName;
      }

      for (const turn of finalTranscripts) {
        if (turn.isSelf || turn.systemNotice) continue;
        const matches = originalName ? turn.speaker === originalName : !!turn.unresolved;
        if (!matches) continue;

        if (renamingPlaceholder || turn.evidenceSource === 'manual' || turn.sessionId !== sessionId) {
          // Manual evidence: outweighs everything, and votes this turn's cluster to the new name
          turn.evidenceName = newName;
          turn.evidenceSource = 'manual';
        }
        if (turn.sessionId !== sessionId) {
          // Earlier sessions aren't re-derived, so set the label directly
          turn.speaker = newName;
          turn.unresolved = undefined;
          turn.resolvedBy = 'manual';
        }
      }
      relabelAll();

      if (tabCtx?.partial) {
        if ((originalName && tabCtx.partial.speaker === originalName) || !originalName) {
          tabCtx.partial = { ...tabCtx.partial, speaker: newName };
        }
      }
      refreshPartialState();
      broadcastUpdate(false);
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

console.log('[Offscreen] MeetAnalyze offscreen recorder (dual-stream, caption-anchored attribution) loaded.');
