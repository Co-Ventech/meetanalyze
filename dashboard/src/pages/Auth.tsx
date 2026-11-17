import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { login, register } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button } from '../components/ui';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <img src="/icon.png" alt="" className="w-8 h-8 rounded" />
          <span className="text-xl font-semibold text-ink">MeetAnalyze</span>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          <p className="text-sm text-ink-3 mt-1 mb-5">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent';

export function LoginPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/meetings';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await login(email.trim(), password));
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="See how your meetings went.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={inputClass} type="email" required placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={inputClass} type="password" required placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm" style={{ color: 'var(--critical)' }}>{error}</p>}
        <Button type="submit" disabled={busy} className="mt-1">{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <p className="text-sm text-ink-3 mt-4 text-center">
        No account? <Link to="/register" className="text-accent underline">Create one</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(name.trim(), email.trim(), password);
      setSession(await login(email.trim(), password));
      navigate('/meetings', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Use the same account in the MeetAnalyze extension.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={inputClass} required placeholder="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputClass} type="email" required placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={inputClass} type="password" required minLength={8} placeholder="Password (min. 8 characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm" style={{ color: 'var(--critical)' }}>{error}</p>}
        <Button type="submit" disabled={busy} className="mt-1">{busy ? 'Creating account…' : 'Create account'}</Button>
      </form>
      <p className="text-sm text-ink-3 mt-4 text-center">
        Already registered? <Link to="/login" className="text-accent underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
