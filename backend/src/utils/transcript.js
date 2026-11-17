/** Helpers for turning caption turns into LLM input and per-speaker stats. */

const NON_LATIN = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿ऀ-ॿЀ-ӿ一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯֐-׿฀-๿Ͱ-Ͽ]/g;

const spokenTurns = (turns) => (turns || []).filter((t) => t && !t.systemNotice && (t.text || '').trim());

const formatTranscript = (turns) =>
    spokenTurns(turns)
        .map((t) => `${t.speaker || 'Speaker'}${t.timestamp ? ` [${t.timestamp}]` : ''}: ${t.text.trim()}`)
        .join('\n\n');

const isMostlyNonEnglish = (text) => {
    const nonLatin = (text.match(NON_LATIN) || []).length;
    const latin = (text.match(/[a-zA-Z]/g) || []).length;
    return nonLatin > 0 && nonLatin >= latin * 0.3;
};

const countWords = (text) => (text.trim().match(/\S+/g) || []).length;

/**
 * Per-speaker talk time, turns and words. Talk time uses caption start/end times when present;
 * otherwise it falls back to word count at ~150 words per minute.
 */
const computeSpeakerStats = (turns) => {
    const bySpeaker = new Map();
    for (const t of spokenTurns(turns)) {
        const name = t.speaker || 'Unknown';
        const s = bySpeaker.get(name) || { speaker: name, isSelf: false, turns: 0, words: 0, talkMs: 0 };
        const words = countWords(t.text);
        s.turns += 1;
        s.words += words;
        const span = Number.isFinite(t.startMs) && Number.isFinite(t.endMs) ? t.endMs - t.startMs : NaN;
        s.talkMs += span > 0 && span < 10 * 60 * 1000 ? span : Math.round((words / 150) * 60000);
        s.isSelf = s.isSelf || !!t.isSelf;
        bySpeaker.set(name, s);
    }
    const stats = [...bySpeaker.values()];
    const totalMs = stats.reduce((a, s) => a + s.talkMs, 0) || 1;
    return stats
        .map((s) => ({ ...s, talkShare: Math.round((s.talkMs / totalMs) * 1000) / 10 }))
        .sort((a, b) => b.talkMs - a.talkMs);
};

module.exports = { formatTranscript, isMostlyNonEnglish, computeSpeakerStats, spokenTurns };
