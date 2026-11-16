import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ApiError, loadSession, saveSession, type Session } from './api';

interface AuthContextValue {
  session: Session | null;
  setSession: (s: Session | null) => void;
  /** Run an API call with the current token; signs out on 401. */
  withToken: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() => loadSession());

  const setSession = useCallback((s: Session | null) => {
    saveSession(s);
    setSessionState(s);
  }, []);

  const withToken = useCallback(
    async <T,>(fn: (token: string) => Promise<T>) => {
      if (!session) throw new ApiError('Please sign in.', 401);
      try {
        return await fn(session.token);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setSession(null);
        throw e;
      }
    },
    [session, setSession],
  );

  const value = useMemo(() => ({ session, setSession, withToken }), [session, setSession, withToken]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
