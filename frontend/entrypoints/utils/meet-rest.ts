/**
 * Google Meet REST API (v2) helpers for post-meeting speaker relabelling.
 *
 * Google's own transcript (conferenceRecords.transcripts.entries) attributes every line to the
 * exact participant. It only exists when the meeting used Google Meet transcription (eligible
 * Workspace plans) and only becomes available a few minutes after the meeting ends, so it is
 * used to *correct* the live transcript, never to drive it.
 *
 * Runs in the background service worker (needs chrome.identity).
 */
import type { TranscriptTurn } from '../common/types';

declare const chrome: any;

const MEET_API = 'https://meet.googleapis.com/v2';
const MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.readonly';

export class MeetApiUnavailableError extends Error {}

export interface MeetEntry {
  participantName: string; // resolved display name
  text: string;
  startMs: number;
  endMs: number;
}

export function isMeetApiConfigured(): boolean {
  return !!chrome.identity?.getAuthToken && !!chrome.runtime?.getManifest?.()?.oauth2?.client_id;
}

export function extractMeetingCode(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  return m?.[1]?.toLowerCase() ?? null;
}

export async function getToken(interactive: boolean): Promise<string> {
  if (!isMeetApiConfigured()) {
    throw new MeetApiUnavailableError('Google OAuth client is not configured for this build.');
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes: [MEET_SCOPE] }, (result: any) => {
      const token = typeof result === 'string' ? result : result?.token;
      if (chrome.runtime.lastError || !token) {
        reject(new MeetApiUnavailableError(chrome.runtime.lastError?.message || 'Not signed in with Google'));
        return;
      }
      resolve(token);
    });
  });
}

async function meetGet(token: string, path: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${MEET_API}/${path}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // Stale token: drop it so the next attempt fetches a fresh one
    await new Promise<void>((r) => chrome.identity.removeCachedAuthToken({ token }, () => r()));
    throw new Error('Google token expired');
  }
  if (res.status === 403 || res.status === 404) {
    throw new MeetApiUnavailableError(`Meet API returned ${res.status} for ${path}`);
  }
  if (!res.ok) {
    throw new Error(`Meet API ${path} failed (HTTP ${res.status})`);
  }
  return res.json();
}

async function listAll(token: string, path: string, key: string, params: Record<string, string> = {}): Promise<any[]> {
  const items: any[] = [];
  let pageToken: string | undefined;
  do {
    const data = await meetGet(token, path, { ...params, pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    if (Array.isArray(data?.[key])) items.push(...data[key]);
    pageToken = data?.nextPageToken;
  } while (pageToken);
  return items;
}

/** Find the conference record for this meeting code closest to the recording window. */
export async function findConferenceRecord(
  token: string,
  meetingCode: string,
  startedAt: number,
  stoppedAt: number
): Promise<any | null> {
  const records = await listAll(token, 'conferenceRecords', 'conferenceRecords', {
    filter: `space.meeting_code = "${meetingCode}"`,
  });
  let best: any = null;
  let bestDistance = Infinity;
  for (const rec of records) {
    const recStart = Date.parse(rec.startTime);
    const recEnd = rec.endTime ? Date.parse(rec.endTime) : Infinity;
    if (Number.isNaN(recStart)) continue;
    // Must overlap the recording window
    if (recStart > stoppedAt || recEnd < startedAt) continue;
    const distance = Math.abs(recStart - startedAt);
    if (distance < bestDistance) {
      best = rec;
      bestDistance = distance;
    }
  }
  return best;
}

const participantCache = new Map<string, string>();

async function resolveParticipant(token: string, participantName: string): Promise<string> {
  const cached = participantCache.get(participantName);
  if (cached) return cached;
  const p = await meetGet(token, participantName);
  const name =
    p?.signedinUser?.displayName || p?.anonymousUser?.displayName || p?.phoneUser?.displayName || 'Participant';
  participantCache.set(participantName, name);
  return name;
}

export type FetchEntriesResult =
  | { status: 'ready'; entries: MeetEntry[] }
  | { status: 'pending' } // record/transcript not finished yet, try again later
  | { status: 'unavailable'; reason: string }; // no Google transcript for this meeting

export async function fetchMeetTranscriptEntries(
  token: string,
  meetingCode: string,
  startedAt: number,
  stoppedAt: number
): Promise<FetchEntriesResult> {
  const record = await findConferenceRecord(token, meetingCode, startedAt, stoppedAt);
  if (!record) return { status: 'pending' };

  const transcripts = await listAll(token, `${record.name}/transcripts`, 'transcripts');
  if (transcripts.length === 0) {
    // Conference ended and still no transcript -> Google transcription wasn't used
    return record.endTime ? { status: 'unavailable', reason: 'No Google Meet transcript for this meeting' } : { status: 'pending' };
  }
  if (!record.endTime || transcripts.some((t) => t.state === 'STARTED')) {
    return { status: 'pending' };
  }

  const entries: MeetEntry[] = [];
  for (const transcript of transcripts) {
    const raw = await listAll(token, `${transcript.name}/entries`, 'transcriptEntries');
    for (const e of raw) {
      if (!e?.participant || !e?.text) continue;
      const startMs = Date.parse(e.startTime);
      const endMs = Date.parse(e.endTime);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
      entries.push({
        participantName: await resolveParticipant(token, e.participant),
        text: e.text,
        startMs,
        endMs,
      });
    }
  }
  return { status: 'ready', entries };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

// Fraction of the local turn's words that also appear in the Meet entry
function containment(local: string, remote: string): number {
  const a = tokenize(local);
  if (a.length === 0) return 0;
  const b = new Set(tokenize(remote));
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.length;
}

/**
 * Relabel remote turns using Google's transcript entries.
 * Returns the updated turns and how many were changed.
 */
export function relabelTurns(turns: TranscriptTurn[], entries: MeetEntry[]): { turns: TranscriptTurn[]; changed: number } {
  const SLACK = 2000;
  const clusterVotes = new Map<string, Map<string, number>>();
  const matchedIds = new Set<string>();
  let changed = 0;

  const updated = turns.map((turn) => {
    if (turn.isSelf || turn.systemNotice || turn.startMs === undefined || turn.endMs === undefined) return turn;
    if (turn.resolvedBy === 'manual' || turn.evidenceSource === 'manual') return turn; // never override a user's correction

    let best: { entry: MeetEntry; score: number } | null = null;
    for (const entry of entries) {
      if (entry.endMs < turn.startMs - SLACK || entry.startMs > turn.endMs + SLACK) continue;
      const score = containment(turn.text, entry.text);
      if (!best || score > best.score) best = { entry, score };
    }
    if (!best || best.score < 0.5) return turn;

    matchedIds.add(turn.id);
    const name = best.entry.participantName;
    if (turn.cluster) {
      const votes = clusterVotes.get(turn.cluster) || new Map<string, number>();
      votes.set(name, (votes.get(name) || 0) + 1);
      clusterVotes.set(turn.cluster, votes);
    }
    if (turn.speaker === name && turn.resolvedBy === 'meet-api') return turn;
    if (turn.speaker !== name) changed++;
    return {
      ...turn,
      speaker: name,
      unresolved: false,
      resolvedBy: 'meet-api' as const,
      evidenceName: name,
      evidenceSource: 'meet-api' as const,
    };
  });

  // Cluster majority vote for turns that couldn't be matched directly
  const clusterWinner = new Map<string, string>();
  for (const [cluster, votes] of clusterVotes) {
    const total = Array.from(votes.values()).reduce((a, b) => a + b, 0);
    const [topName, topCount] = Array.from(votes.entries()).sort((a, b) => b[1] - a[1])[0] || ['', 0];
    if (topName && total >= 2 && topCount / total >= 0.7) clusterWinner.set(cluster, topName);
  }

  const final = updated.map((turn) => {
    if (turn.isSelf || turn.systemNotice || matchedIds.has(turn.id) || !turn.cluster) return turn;
    if (turn.resolvedBy === 'manual' || turn.evidenceSource === 'manual') return turn;
    const winner = clusterWinner.get(turn.cluster);
    if (!winner || turn.speaker === winner) return turn;
    changed++;
    return { ...turn, speaker: winner, unresolved: false, resolvedBy: 'meet-api' as const };
  });

  return { turns: final, changed };
}
