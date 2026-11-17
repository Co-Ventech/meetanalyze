import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMeetings, type MeetingSummary } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatDuration } from '../lib/format';
import { ErrorBox, Layout, OutcomeBadge, Section, Spinner, StatTile, Button } from '../components/ui';
import { ScoreTrend } from '../components/charts';

export function MeetingsPage() {
  const { withToken } = useAuth();
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    withToken(listMeetings).then(setMeetings).catch((e) => setError(e.message));
  };
  useEffect(load, [withToken]);

  const stats = useMemo(() => {
    if (!meetings) return null;
    const scored = meetings.filter((m) => m.overallScore !== null);
    const avg = scored.length ? Math.round(scored.reduce((a, m) => a + m.overallScore!, 0) / scored.length) : null;
    const successful = meetings.filter((m) => m.outcome === 'Successful').length;
    const totalMs = meetings.reduce((a, m) => a + (m.durationMs || 0), 0);
    return { count: meetings.length, avg, successful, totalMs, analysed: scored.length };
  }, [meetings]);

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">Your meetings</h1>
        <p className="text-sm text-ink-3 mt-1">Every call you analyse with the MeetAnalyze extension appears here.</p>
      </div>

      {error && <ErrorBox message={error} action={<Button variant="ghost" onClick={load}>Retry</Button>} />}
      {!meetings && !error && <Spinner label="Loading meetings…" />}

      {meetings && stats && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Meetings" value={stats.count} />
            <StatTile label="Average score" value={stats.avg ?? '—'} hint={stats.avg !== null ? 'out of 100' : undefined} />
            <StatTile
              label="Successful"
              value={stats.analysed ? `${stats.successful}/${stats.analysed}` : '—'}
              hint={stats.analysed ? 'calls rated successful' : undefined}
            />
            <StatTile label="Time in meetings" value={formatDuration(stats.totalMs)} />
          </div>

          {meetings.length > 0 && (
            <Section title="Score over time" subtitle="Overall sales-performance score per meeting (0–100). Click a point to open it.">
              <ScoreTrend meetings={meetings} />
            </Section>
          )}

          <section className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-line">
              <h2 className="text-base font-semibold text-ink">All meetings</h2>
            </div>
            {meetings.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-ink-3">
                No meetings yet. Join a Google Meet call, click <strong className="text-ink-2">Start Capturing Transcript</strong> in the
                extension, then <strong className="text-ink-2">Show Meeting Insight</strong> when you're done.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {meetings.map((m) => (
                  <li key={m.id}>
                    <Link
                      to={`/meetings/${m.id}`}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-4 hover:bg-surface-2 transition"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink truncate">{m.title}</div>
                        <div className="text-xs text-ink-3 mt-0.5 truncate">
                          {formatDateTime(m.startedAt)} · {formatDuration(m.durationMs)}
                          {m.participants.length > 0 && ` · ${m.participants.length} participants`}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        {m.status === 'ready' ? (
                          <OutcomeBadge outcome={m.outcome} size="sm" />
                        ) : (
                          <span className="text-xs text-ink-3">{m.status === 'failed' ? '⚠ Analysis failed' : 'Analysing…'}</span>
                        )}
                        <span className="w-14 text-right">
                          <span className="text-lg font-semibold tabular text-ink">{m.overallScore ?? '—'}</span>
                          {m.overallScore !== null && <span className="text-xs text-ink-3">/100</span>}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Layout>
  );
}
