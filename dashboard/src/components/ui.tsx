import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Outcome } from '../lib/api';
import { OUTCOME_STATUS } from '../lib/format';
import { useAuth } from '../lib/auth';

export function Layout({ children }: { children: ReactNode }) {
  const { session, setSession } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-4">
          <Link to="/meetings" className="flex items-center gap-2 font-semibold text-ink">
            <img src="/icon.png" alt="" className="w-6 h-6 rounded" />
            MeetAnalyze
          </Link>
          {session && (
            <div className="flex items-center gap-3 text-sm min-w-0">
              <span className="text-ink-2 truncate hidden sm:inline">{session.user?.name || session.user?.email}</span>
              <button
                onClick={() => {
                  setSession(null);
                  navigate('/login');
                }}
                className="text-ink-3 hover:text-ink underline cursor-pointer"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}

export function OutcomeBadge({ outcome, size = 'md' }: { outcome: Outcome | null; size?: 'sm' | 'md' }) {
  if (!outcome) return <span className="text-ink-3 text-sm">—</span>;
  const { role, icon } = OUTCOME_STATUS[outcome];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium text-ink ${
        size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'
      }`}
      style={{ borderColor: `var(--${role})`, background: `color-mix(in oklab, var(--${role}) 14%, transparent)` }}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-full text-[10px] leading-none w-4 h-4 text-white"
        style={{ background: `var(--${role})` }}
      >
        {icon}
      </span>
      {outcome}
    </span>
  );
}

export function Section({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-sm text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card p-4 min-w-0">
      <div className="text-xs uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular text-ink truncate">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-2">{hint}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-ink-2 text-sm">
      <span className="w-5 h-5 rounded-full border-2 border-line border-t-accent animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBox({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ borderColor: 'var(--critical)' }}>
      <p className="text-sm text-ink">
        <span aria-hidden className="mr-1.5" style={{ color: 'var(--critical)' }}>⚠</span>
        {message}
      </p>
      {action}
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
        variant === 'primary' ? 'bg-accent text-accent-ink hover:brightness-110' : 'border border-line text-ink hover:bg-surface-2'
      } ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}
