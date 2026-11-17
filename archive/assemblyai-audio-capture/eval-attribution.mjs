#!/usr/bin/env node
/**
 * Score a hand-labelled MeetAnalyze attribution log.
 *
 * 1. Record a meeting, click "Log" in the popup to download the JSON.
 * 2. For each entry in `turns`, set `trueSpeaker` to who actually spoke
 *    (use the same name Meet shows; leave null to skip a turn).
 * 3. node scripts/eval-attribution.mjs path/to/log.json [more logs...]
 *
 * Reports accuracy at emit time and after retroactive fixes, broken down by
 * channel and attribution method, plus the measured lag between AssemblyAI word
 * timing and Meet's DOM speaking indicator.
 */
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/eval-attribution.mjs <log.json> [...]');
  process.exit(1);
}

const norm = (s) =>
  String(s ?? '')
    .replace(/\s*\(you\)\s*$/i, '')
    .trim()
    .toLowerCase();

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const buckets = new Map(); // key -> { n, emitOk, finalOk }
const bump = (key, emitOk, finalOk) => {
  const b = buckets.get(key) || { n: 0, emitOk: 0, finalOk: 0 };
  b.n++;
  if (emitOk) b.emitOk++;
  if (finalOk) b.finalOk++;
  buckets.set(key, b);
};

const startLags = [];
const endLags = [];
const confusions = new Map();
let labelled = 0;
let unlabelled = 0;

for (const file of files) {
  const log = JSON.parse(readFileSync(file, 'utf8'));
  if (log.format !== 'meetanalyze-attribution-log/1') {
    console.warn(`${file}: unexpected format "${log.format}", continuing anyway`);
  }
  const self = norm(log.selfName);
  const intervals = Array.isArray(log.domIntervals) ? log.domIntervals : [];

  for (const t of log.turns || []) {
    if (t.trueSpeaker == null || t.trueSpeaker === '') {
      unlabelled++;
      continue;
    }
    labelled++;
    const truth = norm(t.trueSpeaker);
    const truthIsSelf = truth === 'you' || truth === self;
    const matches = (name) => {
      const n = norm(name);
      return n === truth || (truthIsSelf && (n === 'you' || n === self));
    };
    const dropped = t.method === 'dropped-mic-bleed';
    // A dropped bleed turn is correct only if it was not really the local user.
    const emitOk = dropped ? !truthIsSelf : matches(t.assigned);
    const finalOk = dropped ? !truthIsSelf : matches(t.finalSpeaker ?? t.assigned);

    bump('ALL', emitOk, finalOk);
    bump(`channel:${t.channel}`, emitOk, finalOk);
    bump(`method:${t.method}`, emitOk, finalOk);
    if (!finalOk) {
      const key = `${t.trueSpeaker} -> ${dropped ? '(dropped as bleed)' : t.finalSpeaker ?? t.assigned}`;
      confusions.set(key, (confusions.get(key) || 0) + 1);
    }

    // DOM lag: compare word-timed remote turns with the true speaker's nearest DOM interval.
    if (t.channel === 'tab' && t.timed && !truthIsSelf) {
      let best = null;
      for (const iv of intervals) {
        if (norm(iv.speaker) !== truth) continue;
        const overlap = Math.min(t.endMs + 3000, iv.end) - Math.max(t.startMs - 3000, iv.start);
        if (overlap > 0 && (!best || overlap > best.overlap)) best = { iv, overlap };
      }
      if (best) {
        startLags.push(best.iv.start - t.startMs);
        endLags.push(best.iv.end - t.endMs);
      }
    }
  }
}

console.log(`Labelled turns: ${labelled} (skipped ${unlabelled} unlabelled)\n`);
console.log('bucket'.padEnd(28), 'n'.padStart(5), 'at emit'.padStart(9), 'final'.padStart(9));
const keys = [...buckets.keys()].sort((a, b) => (a === 'ALL' ? -1 : b === 'ALL' ? 1 : a.localeCompare(b)));
for (const k of keys) {
  const b = buckets.get(k);
  console.log(k.padEnd(28), String(b.n).padStart(5), pct(b.emitOk, b.n).padStart(9), pct(b.finalOk, b.n).padStart(9));
}

if (confusions.size) {
  console.log('\nMost common errors (truth -> shown):');
  [...confusions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
}

console.log('\nDOM indicator lag vs AssemblyAI word timing (positive = DOM later):');
console.log(`  start: median ${median(startLags)?.toFixed(0) ?? '-'} ms over ${startLags.length} turns`);
console.log(`  end:   median ${median(endLags)?.toFixed(0) ?? '-'} ms over ${endLags.length} turns`);
console.log('  Use these to tune DOM_LEAD_TOLERANCE_MS / DOM_LAG_TOLERANCE_MS in entrypoints/offscreen/main.ts.');
