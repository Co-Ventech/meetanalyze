export const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:5000').replace(/\/+$/, '');

export interface User {
  user_id: string;
  name: string;
  email: string;
}

export interface Session {
  token: string;
  user: User;
}

export interface TranscriptTurn {
  id: string;
  speaker: string;
  isSelf: boolean;
  text: string;
  timestamp: string;
  startMs?: number;
  endMs?: number;
  systemNotice?: boolean;
}

export interface EvidencePoint {
  point: string;
  evidence: string;
}

export interface ScorecardRow {
  category: string;
  score: number | null;
  comment: string;
}

export type Outcome = 'Successful' | 'Partially Successful' | 'Unsuccessful';

export interface Insight {
  outcome: Outcome | null;
  outcomeReason: string;
  overallScore: number | null;
  summary: string;
  strongPoints: EvidencePoint[];
  weakPoints: EvidencePoint[];
  improvements: EvidencePoint[];
  scorecard: ScorecardRow[];
  recommendations: {
    strengths: string[];
    weaknesses: string[];
    improvements: string[];
    managerAssessment: string;
  };
  limitations: string[];
}

export interface SpeakerStat {
  speaker: string;
  isSelf: boolean;
  turns: number;
  words: number;
  talkMs: number;
  talkShare: number;
}

export type MeetingStatus = 'processing' | 'ready' | 'failed';

export interface MeetingSummary {
  id: string;
  title: string;
  meetCode: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  participants: string[];
  status: MeetingStatus;
  outcome: Outcome | null;
  overallScore: number | null;
  createdAt: string;
}

export interface MeetingDetail extends MeetingSummary {
  transcript: TranscriptTurn[];
  speakerStats: SpeakerStat[];
  insight: Insight | null;
  model: string | null;
  error: string | null;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const SESSION_KEY = 'meetanalyze.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s?.token ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable: session lasts for this page only
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError('Cannot reach the MeetAnalyze server. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.message || `Server returned HTTP ${res.status}`, res.status);
  return data as T;
}

export async function login(email: string, password: string): Promise<Session> {
  const data = await request<{ data: { accessToken: string; user: User } }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return { token: data.data.accessToken, user: data.data.user };
}

export async function register(name: string, email: string, password: string): Promise<void> {
  await request('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
}

export const listMeetings = (token: string) =>
  request<{ data: MeetingSummary[] }>('/meetings', {}, token).then((r) => r.data);

export const getMeeting = (token: string, id: string) =>
  request<{ data: MeetingDetail }>(`/meetings/${encodeURIComponent(id)}`, {}, token).then((r) => r.data);

export const retryMeeting = (token: string, id: string) =>
  request<{ data: MeetingDetail }>(`/meetings/${encodeURIComponent(id)}/retry`, { method: 'POST' }, token).then((r) => r.data);

export const deleteMeeting = (token: string, id: string) =>
  request(`/meetings/${encodeURIComponent(id)}`, { method: 'DELETE' }, token);
