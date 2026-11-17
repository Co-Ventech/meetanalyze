import type { CaptureMeta, TranscriptTurn } from './types';

const env = (import.meta as any).env ?? {};

export const API_BASE_URL: string = (env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
export const DASHBOARD_URL: string = (env.VITE_DASHBOARD_URL || 'http://localhost:5173').replace(/\/+$/, '');

export interface AuthSession {
  token: string;
  user: { user_id: string; name: string; email: string };
}

const AUTH_KEY = 'authSession';

export async function getSession(): Promise<AuthSession | null> {
  try {
    const stored = await browser.storage.local.get(AUTH_KEY);
    const session = (stored as any)?.[AUTH_KEY] as AuthSession | undefined;
    return session?.token ? session : null;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await browser.storage.local.remove(AUTH_KEY);
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.message) return data.message;
  } catch {}
  return `Server returned HTTP ${res.status}`;
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  const session: AuthSession = { token: data?.data?.accessToken, user: data?.data?.user };
  if (!session.token) throw new Error('Login succeeded but no token was returned.');
  await browser.storage.local.set({ [AUTH_KEY]: session });
  return session;
}

export class AuthError extends Error {}

/** Save the meeting and run the analysis. Returns the new meeting id (even if analysis failed). */
export async function submitMeeting(
  session: AuthSession,
  meta: CaptureMeta | null,
  transcript: TranscriptTurn[],
): Promise<{ id: string; analysisFailed: boolean; message?: string }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({
      meetCode: meta?.meetCode || null,
      title: meta?.title || null,
      startedAt: meta?.startedAt ? new Date(meta.startedAt).toISOString() : null,
      endedAt: new Date(meta?.endedAt || Date.now()).toISOString(),
      participants: meta?.participants || [],
      transcript,
    }),
  });

  if (res.status === 401) {
    await clearSession();
    throw new AuthError('Your session expired. Please sign in again.');
  }

  const data = await res.json().catch(() => null);
  const id = data?.data?.id as string | undefined;
  if (res.ok && id) return { id, analysisFailed: false };
  if (id) return { id, analysisFailed: true, message: data?.message };
  throw new Error(data?.message || `Server returned HTTP ${res.status}`);
}

export const meetingDashboardUrl = (id: string) => `${DASHBOARD_URL}/meetings/${id}`;
