import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MeetingSummary, ScorecardRow, SpeakerStat } from '../lib/api';
import { formatDate, formatTalk, scoreBand, SERIES } from '../lib/format';

/* ---------- shared tooltip ---------- */

function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const show = (e: React.MouseEvent | React.FocusEvent, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const target = (e.target as Element).getBoundingClientRect();
    const x = 'clientX' in e ? e.clientX - box.left : target.left + target.width / 2 - box.left;
    const y = 'clientY' in e ? e.clientY - box.top : target.top - box.top;
    setTip({ x, y, content });
  };
  const hide = () => setTip(null);
  const node = tip && (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 max-w-[280px] rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink shadow-lg"
      style={{
        left: Math.min(Math.max(tip.x, 8), (ref.current?.clientWidth ?? 0) - 8),
        top: tip.y - 12,
        transform: `translate(${tip.x > (ref.current?.clientWidth ?? 0) / 2 ? '-100%' : '0'}, -100%)`,
      }}
    >
      {tip.content}
    </div>
  );
  return { ref, show, hide, node };
}

/* ---------- overall score (hero number + meter) ---------- */

export function ScoreHero({ score }: { score: number | null }) {
  const band = scoreBand(score);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <span className="text-5xl font-semibold tabular text-ink leading-none">{score ?? '—'}</span>
        <span className="text-ink-3 text-lg pb-0.5">/ 100</span>
      </div>
      <div
        className="h-2.5 w-full rounded-full bg-track overflow-hidden"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score ?? undefined}
        aria-label="Overall sales performance score"
      >
        {score !== null && <div className="h-full rounded-full bg-accent" style={{ width: `${score}%` }} />}
      </div>
      {band && (
        <div className="flex items-center gap-1.5 text-sm text-ink-2">
          <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{ background: `var(--${band.role})` }} />
          {band.label}
        </div>
      )}
    </div>
  );
}

/* ---------- scorecard: horizontal bars on a 0–10 scale ---------- */

export function ScorecardBars({ rows }: { rows: ScorecardRow[] }) {
  const { ref, show, hide, node } = useTooltip();
  if (!rows.length) return <p className="text-sm text-ink-3">No scorecard was produced for this meeting.</p>;

  return (
    <div ref={ref} className="relative">
      <div className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] sm:grid-cols-[minmax(0,12rem)_1fr_3rem] gap-x-3 gap-y-2.5 items-center">
        {rows.map((row) => {
          const assessable = row.score !== null;
          const tipContent = (
            <>
              <div className="font-semibold mb-0.5">
                {row.category}: {assessable ? `${row.score}/10` : 'Not assessable'}
              </div>
              {row.comment && <div className="text-ink-2">{row.comment}</div>}
            </>
          );
          return (
            <div
              key={row.category}
              className="contents"
              tabIndex={0}
              onMouseMove={(e) => show(e, tipContent)}
              onMouseLeave={hide}
              onFocus={(e) => show(e, tipContent)}
              onBlur={hide}
            >
              <span className="text-sm text-ink-2 truncate" title={row.category}>
                {row.category}
              </span>
              <div className="relative h-5 flex items-center">
                <div className="absolute inset-x-0 h-2 rounded-full bg-track" />
                {/* gridlines at 5 and 10 */}
                <div className="absolute top-0 bottom-0 w-px bg-line" style={{ left: '50%' }} />
                {assessable ? (
                  <div
                    className="relative h-2 rounded-full"
                    style={{ width: `${(row.score! / 10) * 100}%`, background: 'var(--series-1)' }}
                  />
                ) : (
                  <span className="relative text-xs text-ink-3 italic pl-1 bg-surface">Not assessable</span>
                )}
              </div>
              <span className="text-sm tabular text-ink text-right">{assessable ? row.score : '—'}</span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] sm:grid-cols-[minmax(0,12rem)_1fr_3rem] gap-x-3 mt-1.5">
        <span />
        <div className="flex justify-between text-[11px] text-ink-3 tabular">
          <span>0</span>
          <span>5</span>
          <span>10</span>
        </div>
        <span />
      </div>
      {node}
    </div>
  );
}

/* ---------- talk time: one segmented bar + legend ---------- */

export function TalkTime({ stats }: { stats: SpeakerStat[] }) {
  const { ref, show, hide, node } = useTooltip();
  // Fixed colour per speaker in talk-time order; anything past 7 folds into "Other"
  const segments = useMemo(() => {
    const top = stats.slice(0, 7);
    const rest = stats.slice(7);
    const rows = top.map((s, i) => ({ ...s, color: SERIES[i]! }));
    if (rest.length) {
      rows.push({
        speaker: `Other (${rest.length})`,
        isSelf: false,
        turns: rest.reduce((a, s) => a + s.turns, 0),
        words: rest.reduce((a, s) => a + s.words, 0),
        talkMs: rest.reduce((a, s) => a + s.talkMs, 0),
        talkShare: Math.round(rest.reduce((a, s) => a + s.talkShare, 0) * 10) / 10,
        color: 'var(--text-muted)',
      });
    }
    return rows;
  }, [stats]);

  if (!segments.length) return <p className="text-sm text-ink-3">No speech was captured.</p>;

  return (
    <div ref={ref} className="relative flex flex-col gap-4">
      <div className="flex h-4 w-full gap-[2px] rounded-full overflow-hidden" role="img" aria-label="Share of talk time per speaker">
        {segments.map((s) => {
          const content = (
            <>
              <div className="font-semibold">{s.speaker}{s.isSelf ? ' (you)' : ''}</div>
              <div className="text-ink-2 tabular">
                {s.talkShare}% · {formatTalk(s.talkMs)} · {s.turns} turns · {s.words} words
              </div>
            </>
          );
          return (
            <div
              key={s.speaker}
              tabIndex={0}
              className="h-full min-w-[3px] outline-offset-2"
              style={{ flexGrow: Math.max(s.talkShare, 0.5), flexBasis: 0, background: s.color }}
              onMouseMove={(e) => show(e, content)}
              onMouseLeave={hide}
              onFocus={(e) => show(e, content)}
              onBlur={hide}
            />
          );
        })}
      </div>
      <ul className="flex flex-col gap-2">
        {segments.map((s) => (
          <li key={s.speaker} className="flex items-center gap-2 text-sm min-w-0">
            <span aria-hidden className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="text-ink truncate">
              {s.speaker}
              {s.isSelf && <span className="text-ink-3"> (you)</span>}
            </span>
            <span className="ml-auto tabular text-ink-2 shrink-0">
              {s.talkShare}% <span className="text-ink-3">· {formatTalk(s.talkMs)}</span>
            </span>
          </li>
        ))}
      </ul>
      {node}
    </div>
  );
}

/* ---------- score trend across meetings ---------- */

export function ScoreTrend({ meetings }: { meetings: MeetingSummary[] }) {
  const navigate = useNavigate();
  const { ref, show, hide, node } = useTooltip();
  const points = useMemo(
    () =>
      meetings
        .filter((m) => m.overallScore !== null)
        .sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt))
        .slice(-20),
    [meetings],
  );

  if (points.length < 2) {
    return <p className="text-sm text-ink-3">The trend appears once you have two or more analysed meetings.</p>;
  }

  const W = 600;
  const H = 180;
  const pad = { l: 32, r: 12, t: 12, b: 24 };
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.overallScore!).toFixed(1)}`).join(' ');

  return (
    <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Overall score per meeting over time">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {v}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => {
          const content = (
            <>
              <div className="font-semibold truncate">{p.title}</div>
              <div className="text-ink-2">
                {formatDate(p.startedAt)} · score <span className="tabular">{p.overallScore}</span>
              </div>
            </>
          );
          return (
            <g key={p.id}>
              <circle cx={x(i)} cy={y(p.overallScore!)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
              {/* larger invisible hit target */}
              <circle
                cx={x(i)}
                cy={y(p.overallScore!)}
                r={14}
                fill="transparent"
                className="cursor-pointer"
                tabIndex={0}
                onMouseMove={(e) => show(e, content)}
                onMouseLeave={hide}
                onFocus={(e) => show(e, content)}
                onBlur={hide}
                onClick={() => navigate(`/meetings/${p.id}`)}
              />
            </g>
          );
        })}
        <text x={pad.l} y={H - 6} fontSize={11} fill="var(--text-muted)">
          {formatDate(points[0]!.startedAt)}
        </text>
        <text x={W - pad.r} y={H - 6} fontSize={11} fill="var(--text-muted)" textAnchor="end">
          {formatDate(points[points.length - 1]!.startedAt)}
        </text>
      </svg>
      {node}
    </div>
  );
}
