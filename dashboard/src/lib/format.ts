import type { Outcome } from './api';

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return '<1 min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTalk(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Outcome → status role. Status colours always ship with an icon and a label. */
export const OUTCOME_STATUS: Record<Outcome, { role: 'good' | 'warning' | 'critical'; icon: string }> = {
  Successful: { role: 'good', icon: '✓' },
  'Partially Successful': { role: 'warning', icon: '◐' },
  Unsuccessful: { role: 'critical', icon: '✕' },
};

/** Score band for the 0–100 overall score. */
export function scoreBand(score: number | null): { label: string; role: 'good' | 'warning' | 'serious' | 'critical' } | null {
  if (score === null || score === undefined) return null;
  if (score >= 75) return { label: 'Strong', role: 'good' };
  if (score >= 60) return { label: 'Solid', role: 'warning' };
  if (score >= 40) return { label: 'Needs work', role: 'serious' };
  return { label: 'Weak', role: 'critical' };
}

export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
