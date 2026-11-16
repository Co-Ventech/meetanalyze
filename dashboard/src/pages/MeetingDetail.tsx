import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteMeeting, getMeeting, retryMeeting, type EvidencePoint, type MeetingDetail } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatDuration } from '../lib/format';
import { Button, ErrorBox, Layout, OutcomeBadge, Section, Spinner, StatTile } from '../components/ui';
import { ScoreHero, ScorecardBars, TalkTime } from '../components/charts';

function PointList({ items, role }: { items: EvidencePoint[]; role: 'good' | 'critical' | 'accent' }) {
  if (!items.length) return <p className="text-sm text-ink-3">Nothing noted.</p>;
  const color = role === 'accent' ? 'var(--accent)' : `var(--${role})`;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((p, i) => (
        <li key={i} className="pl-3 border-l-2" style={{ borderColor: color }}>
          <div className="text-sm font-medium text-ink">{p.point}</div>
          {p.evidence && <div className="text-sm text-ink-2 mt-0.5">{p.evidence}</div>}
        </li>
      ))}
    </ul>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-sm text-ink-3">—</p>;
  return (
    <ul className="list-disc pl-5 flex flex-col gap-1 text-sm text-ink-2 marker:text-ink-3">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

export function MeetingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { withToken } = useAuth();
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    setError(null);
    withToken((t) => getMeeting(t, id)).then(setMeeting).catch((e) => setError(e.message));
  }, [id, withToken]);

  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      setMeeting(await withToken((t) => retryMeeting(t, id)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this meeting and its analysis? This cannot be undone.')) return;
    try {
      await withToken((t) => deleteMeeting(t, id));
      navigate('/meetings');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const insight = meeting?.insight;
  const turns = meeting?.transcript.filter((t) => !t.systemNotice && t.text?.trim()) ?? [];

  return (
    <Layout>
      <Link to="/meetings" className="text-sm text-ink-3 hover:text-ink">← All meetings</Link>

      {error && <div className="mt-4"><ErrorBox message={error} /></div>}
      {!meeting && !error && <Spinner label="Loading meeting…" />}

      {meeting && (
        <div className="flex flex-col gap-6 mt-3">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-ink break-words">{meeting.title}</h1>
              <p className="text-sm text-ink-3 mt-1">
                {formatDateTime(meeting.startedAt)}
                {meeting.meetCode && ` · ${meeting.meetCode}`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {meeting.status === 'ready' && <OutcomeBadge outcome={insight?.outcome ?? null} />}
              <Button variant="ghost" onClick={remove}>Delete</Button>
            </div>
          </div>

          {meeting.status !== 'ready' || !insight ? (
            <ErrorBox
              message={
                meeting.status === 'processing'
                  ? 'This meeting is still being analysed.'
                  : `The analysis did not complete${meeting.error ? `: ${meeting.error.slice(0, 200)}` : '.'}`
              }
              action={<Button onClick={retry} disabled={retrying}>{retrying ? 'Analysing…' : 'Run analysis again'}</Button>}
            />
          ) : (
            <>
              {/* Headline */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <section className="card p-5 lg:col-span-1">
                  <div className="text-xs uppercase tracking-wide text-ink-3 mb-3">Overall score</div>
                  <ScoreHero score={insight.overallScore} />
                  {insight.outcomeReason && <p className="text-sm text-ink-2 mt-4">{insight.outcomeReason}</p>}
                </section>
                <section className="card p-5 lg:col-span-2">
                  <div className="text-xs uppercase tracking-wide text-ink-3 mb-2">How the meeting went</div>
                  <p className="text-[15px] leading-relaxed text-ink">{insight.summary || 'No summary was produced.'}</p>
                </section>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile label="Duration" value={formatDuration(meeting.durationMs)} />
                <StatTile label="Participants" value={meeting.participants.length || meeting.speakerStats.length} />
                <StatTile label="Turns spoken" value={turns.length} />
                <StatTile
                  label="Skills assessed"
                  value={`${insight.scorecard.filter((r) => r.score !== null).length}/${insight.scorecard.length}`}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <Section title="Sales performance scorecard" subtitle="Each skill rated 1–10. Hover a row for the reasoning." className="lg:col-span-3">
                  <ScorecardBars rows={insight.scorecard} />
                </Section>
                <Section title="Talk time" subtitle="Share of speaking time from the captions." className="lg:col-span-2">
                  <TalkTime stats={meeting.speakerStats} />
                </Section>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Section title="What went well">
                  <PointList items={insight.strongPoints} role="good" />
                </Section>
                <Section title="What went wrong">
                  <PointList items={insight.weakPoints} role="critical" />
                </Section>
              </div>

              <Section title="How to improve">
                <PointList items={insight.improvements} role="accent" />
              </Section>

              <Section title="Manager's assessment">
                {insight.recommendations.managerAssessment && (
                  <p className="text-[15px] leading-relaxed text-ink mb-5">{insight.recommendations.managerAssessment}</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div>
                    <h3 className="text-sm font-semibold text-ink mb-2">Top strengths</h3>
                    <Bullets items={insight.recommendations.strengths} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-ink mb-2">Top weaknesses</h3>
                    <Bullets items={insight.recommendations.weaknesses} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-ink mb-2">Next-call actions</h3>
                    <Bullets items={insight.recommendations.improvements} />
                  </div>
                </div>
                {insight.limitations.length > 0 && (
                  <div className="mt-5 pt-4 border-t border-line">
                    <h3 className="text-xs uppercase tracking-wide text-ink-3 mb-1.5">Assessment limitations</h3>
                    <Bullets items={insight.limitations} />
                  </div>
                )}
              </Section>
            </>
          )}

          {/* Transcript */}
          <section className="card">
            <button
              onClick={() => setShowTranscript((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer"
              aria-expanded={showTranscript}
            >
              <span>
                <span className="text-base font-semibold text-ink">Transcript</span>
                <span className="text-sm text-ink-3 ml-2">{turns.length} turns · from Google Meet captions</span>
              </span>
              <span className="text-ink-3">{showTranscript ? '▲' : '▼'}</span>
            </button>
            {showTranscript && (
              <ol className="border-t border-line px-5 py-4 flex flex-col gap-3 max-h-[600px] overflow-y-auto">
                {turns.map((t) => (
                  <li key={t.id} className="flex gap-3 text-sm">
                    <span className="w-14 shrink-0 text-xs text-ink-3 tabular pt-0.5">{t.timestamp}</span>
                    <div className="min-w-0">
                      <span className="font-semibold text-ink">{t.speaker}</span>
                      {t.isSelf && <span className="text-ink-3 text-xs"> (you)</span>}
                      <p className="text-ink-2">{t.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {meeting.model && <p className="text-xs text-ink-3">Analysed with {meeting.model}.</p>}
        </div>
      )}
    </Layout>
  );
}
