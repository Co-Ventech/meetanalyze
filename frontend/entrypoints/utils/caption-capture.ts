import type { CaptureMeta, CaptureStorage, MeetingSubmission, PartialTranscriptState, TranscriptTurn } from '../common/types';
import { MEET_SELECTORS } from './meet-selectors';
import { mergeCaptionText, normalizeCaption } from './caption-merge';

/**
 * Reads Google Meet's live captions (speaker name + words) and turns them into transcript turns.
 * The content script owns this state and persists it to chrome.storage.local, which the popup,
 * side panel and background all read from.
 */

const IDLE_COMMIT_MS = 2500;      // finalize a turn once its caption text stops changing
const SCAN_INTERVAL_MS = 400;     // safety-net scan in addition to the MutationObserver
const PERSIST_THROTTLE_MS = 300;
const CAPTIONS_RETRY_MS = 3000;
const PARTICIPANT_SCAN_MS = 5000;
// Restarting within this window after a stop continues the same transcript; later, a new one starts.
const RESUME_WINDOW_MS = 5 * 60 * 1000;

interface BlockState {
  speaker: string;
  isSelf: boolean;
  full: string;          // all text accumulated for this caption block
  committed: number;     // length of `full` already emitted as final turns
  segStart: number | null;
  lastChange: number;
}

export interface CaptionCaptureDeps {
  getSelfName: () => string;
  cleanName: (name: string) => string;
  isInvalidName: (name: string) => boolean;
  getParticipantNames: () => string[];
  /** Called when the user leaves the call while capturing. */
  onMeetingEnded: (meta: CaptureMeta, transcript: TranscriptTurn[]) => void;
}

const formatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function getMeetCode(): string {
  const m = location.pathname.match(/^\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})/i);
  return m?.[1] ?? '';
}

function getMeetingTitle(meetCode: string): string {
  const el = document.querySelector(MEET_SELECTORS.meetingTitle);
  const fromDom = normalizeCaption(el?.textContent || '');
  if (fromDom && fromDom.length < 120) return fromDom;
  const fromTitle = document.title.replace(/^\s*(Google\s+)?Meet\s*[-–—:]\s*/i, '').trim();
  if (fromTitle && fromTitle.toLowerCase() !== 'meet' && fromTitle.toLowerCase() !== 'google meet') return fromTitle;
  return meetCode ? `Meeting ${meetCode}` : 'Google Meet call';
}

export function createCaptionCapture(deps: CaptionCaptureDeps) {
  let capturing = false;
  let captionsOn = false;
  let captureError: string | null = null;
  let finals: TranscriptTurn[] = [];
  let partial: PartialTranscriptState | null = null;
  let meta: CaptureMeta | null = null;
  let turnCounter = 0;
  let seenInCall = false;
  let submittedStartedAt: number | null = null;

  const blocks = new Map<Element, BlockState>();
  let observer: MutationObserver | null = null;
  let observedRegion: Element | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let participantTimer: ReturnType<typeof setInterval> | null = null;
  let lastCaptionsAttempt = 0;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- persistence ----------

  const snapshot = (): CaptureStorage => ({
    isRecording: capturing,
    captionsOn,
    partialTranscript: partial,
    finalTranscripts: finals,
    captureMeta: meta,
    captureError,
  });

  const persistNow = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try {
      browser.storage.local.set(snapshot() as unknown as Record<string, unknown>).catch(() => {});
    } catch {
      // extension context invalidated (extension reloaded) — nothing to do
    }
  };

  const persistSoon = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(persistNow, PERSIST_THROTTLE_MS);
  };

  // ---------- DOM reading ----------

  const findRegion = (): Element | null => document.querySelector(MEET_SELECTORS.captionContainer);

  const resolveSpeaker = (raw: string): { speaker: string; isSelf: boolean } => {
    const name = deps.cleanName(raw);
    const selfName = deps.getSelfName();
    const isSelf = !name || /^you$/i.test(name) || (!!selfName && name.toLowerCase() === selfName.toLowerCase());
    if (isSelf) return { speaker: selfName && selfName !== 'You' ? selfName : 'You', isSelf: true };
    return { speaker: name, isSelf: false };
  };

  const findBlocks = (region: Element): Element[] => {
    const matched = Array.from(region.querySelectorAll(MEET_SELECTORS.captionBlocks));
    const set = new Set(matched);
    // keep outermost matches only (selectors can match nested elements of the same block)
    let result = matched.filter((el) => {
      for (let p = el.parentElement; p && p !== region; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
    if (result.length) return result;

    // Structural fallback: each speaker-name element's block is the ancestor that also holds text.
    result = [];
    for (const nameEl of Array.from(region.querySelectorAll(MEET_SELECTORS.captionSpeakers))) {
      let block: Element | null = nameEl.parentElement;
      while (block && block.parentElement && block.parentElement !== region &&
        normalizeCaption(block.textContent || '') === normalizeCaption(nameEl.textContent || '')) {
        block = block.parentElement;
      }
      if (block && !result.includes(block)) result.push(block);
    }
    return result;
  };

  const readBlock = (block: Element): { rawSpeaker: string; text: string } => {
    const nameEl = block.querySelector(MEET_SELECTORS.captionSpeakers);
    const rawSpeaker = normalizeCaption(nameEl?.textContent || '');
    const textEl = block.querySelector(MEET_SELECTORS.captionText);
    let text = normalizeCaption(textEl?.textContent || '');
    if (!textEl) {
      text = normalizeCaption(block.textContent || '');
      if (rawSpeaker && text.startsWith(rawSpeaker)) text = text.slice(rawSpeaker.length).trim();
    }
    return { rawSpeaker, text };
  };

  // ---------- turn bookkeeping ----------

  const commit = (st: BlockState, now = Date.now()) => {
    const text = st.full.slice(st.committed).trim();
    st.committed = st.full.length;
    if (!text) {
      st.segStart = null;
      return;
    }
    const startMs = st.segStart ?? now;
    finals.push({
      id: `cap_${startMs}_${++turnCounter}`,
      speaker: st.speaker,
      isSelf: st.isSelf,
      text,
      timestamp: formatClock(startMs),
      startMs,
      endMs: Math.max(st.lastChange, startMs),
    });
    st.segStart = null;
  };

  const commitAll = () => {
    for (const st of blocks.values()) commit(st);
    blocks.clear();
    partial = null;
  };

  const scan = () => {
    if (!capturing) return;
    const now = Date.now();

    // Auto-stop once the user leaves the call (the Leave button disappears after being seen)
    const inCall = !!document.querySelector(MEET_SELECTORS.inCallIndicator);
    if (inCall) seenInCall = true;
    else if (seenInCall) {
      stop({ meetingEnded: true });
      return;
    }

    const region = findRegion();
    if (!region) {
      if (captionsOn || blocks.size) {
        captionsOn = false;
        commitAll();
        persistSoon();
      }
      ensureCaptionsOn();
      return;
    }
    if (!captionsOn) {
      captionsOn = true;
      captureError = null;
      persistSoon();
    }
    if (region !== observedRegion) watchRegion(region);

    let changed = false;
    const els = findBlocks(region);
    const present = new Set(els);

    // Blocks that scrolled out of the caption area are finished
    for (const [el, st] of blocks) {
      if (!present.has(el) || !el.isConnected) {
        commit(st, now);
        blocks.delete(el);
        changed = true;
      }
    }

    els.forEach((el, index) => {
      const { rawSpeaker, text } = readBlock(el);
      let st = blocks.get(el);
      if (!st) {
        if (!text) return;
        const who = resolveSpeaker(rawSpeaker);
        if (!who.isSelf && deps.isInvalidName(who.speaker)) who.speaker = 'Participant';
        st = { ...who, full: '', committed: 0, segStart: null, lastChange: now };
        blocks.set(el, st);
      } else if (rawSpeaker) {
        // Meet occasionally reuses a block element for a different speaker
        const who = resolveSpeaker(rawSpeaker);
        if (who.speaker !== st.speaker && !deps.isInvalidName(who.speaker)) {
          commit(st, now);
          st = { ...who, full: '', committed: 0, segStart: null, lastChange: now };
          blocks.set(el, st);
        }
      }

      const merged = mergeCaptionText(st.full, text, st.committed);
      if (merged !== st.full) {
        if (st.segStart === null) st.segStart = now;
        st.full = merged;
        st.lastChange = now;
        changed = true;
      }

      // A block is finished once a later block from someone else exists, or it has gone quiet
      const later = els.slice(index + 1).some((other) => {
        const o = blocks.get(other);
        return o && o.speaker !== st!.speaker;
      });
      if (st.full.length > st.committed && (later || now - st.lastChange > IDLE_COMMIT_MS)) {
        commit(st, now);
        changed = true;
      }
    });

    // Partial = the newest block's uncommitted text
    let nextPartial: PartialTranscriptState | null = null;
    for (let i = els.length - 1; i >= 0; i--) {
      const st = blocks.get(els[i]!);
      if (st && st.full.length > st.committed) {
        nextPartial = { speaker: st.speaker, isSelf: st.isSelf, text: st.full.slice(st.committed).trim() };
        break;
      }
    }
    if (nextPartial?.text !== partial?.text || nextPartial?.speaker !== partial?.speaker) {
      partial = nextPartial;
      changed = true;
    }

    if (changed) persistSoon();
  };

  const watchRegion = (region: Element) => {
    observer?.disconnect();
    observedRegion = region;
    observer = new MutationObserver(() => scan());
    observer.observe(region, { childList: true, subtree: true, characterData: true });
  };

  // ---------- captions toggle ----------

  const ensureCaptionsOn = () => {
    const now = Date.now();
    if (now - lastCaptionsAttempt < CAPTIONS_RETRY_MS) return;
    lastCaptionsAttempt = now;

    const btn = document.querySelector<HTMLButtonElement>(MEET_SELECTORS.captionsOnButton);
    if (btn) {
      btn.click();
    } else if (document.querySelector(MEET_SELECTORS.inCallIndicator)) {
      // Meet's keyboard shortcut for captions
      const init = { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true } as KeyboardEventInit;
      document.body.dispatchEvent(new KeyboardEvent('keydown', init));
      document.body.dispatchEvent(new KeyboardEvent('keyup', init));
    }

    const inCall = !!document.querySelector(MEET_SELECTORS.inCallIndicator);
    const msg = inCall
      ? 'Waiting for Google Meet captions. If they do not appear, click the CC button in Meet.'
      : 'Join the call first. Capture starts as soon as captions appear.';
    if (captureError !== msg) {
      captureError = msg;
      persistSoon();
    }
  };

  // ---------- participants ----------

  const refreshParticipants = () => {
    if (!meta) return;
    const selfName = deps.getSelfName();
    if (selfName && selfName !== 'You') meta.selfName = selfName;
    // Re-check stored names too, so junk captured before a filter fix doesn't stick around.
    const names = new Set(meta.participants.map(deps.cleanName).filter((n) => !deps.isInvalidName(n)));
    if (meta.selfName && meta.selfName !== 'You') names.add(meta.selfName);
    for (const n of deps.getParticipantNames()) names.add(n);
    for (const t of finals) if (t.speaker && t.speaker !== 'Participant' && t.speaker !== 'You') names.add(t.speaker);
    if (names.size !== meta.participants.length || [...names].some((n, i) => n !== meta!.participants[i])) {
      meta.participants = Array.from(names);
      persistSoon();
    }
  };

  // ---------- public API ----------

  function start(options: { resume?: boolean } = {}) {
    const meetCode = getMeetCode();
    const canContinue =
      !!meta &&
      meta.meetCode === meetCode &&
      meta.startedAt !== submittedStartedAt &&
      (options.resume || (!!meta.endedAt && Date.now() - meta.endedAt < RESUME_WINDOW_MS));
    if (canContinue && meta) {
      meta.endedAt = undefined;
    } else {
      finals = [];
      partial = null;
      meta = {
        meetCode,
        title: getMeetingTitle(meetCode),
        startedAt: Date.now(),
        selfName: deps.getSelfName(),
        participants: [],
      };
    }
    capturing = true;
    captionsOn = false;
    captureError = null;
    seenInCall = !!document.querySelector(MEET_SELECTORS.inCallIndicator);
    lastCaptionsAttempt = 0;
    blocks.clear();

    scanTimer && clearInterval(scanTimer);
    participantTimer && clearInterval(participantTimer);
    scanTimer = setInterval(scan, SCAN_INTERVAL_MS);
    participantTimer = setInterval(refreshParticipants, PARTICIPANT_SCAN_MS);
    refreshParticipants();
    scan();
    persistNow();
  }

  function stop(options: { meetingEnded?: boolean } = {}) {
    if (!capturing) return;
    commitAll();
    capturing = false;
    captureError = null;
    scanTimer && clearInterval(scanTimer);
    participantTimer && clearInterval(participantTimer);
    scanTimer = participantTimer = null;
    observer?.disconnect();
    observer = null;
    observedRegion = null;
    refreshParticipants();
    if (meta) {
      meta.endedAt = Date.now();
      if (meta.title.startsWith('Meeting ') || meta.title === 'Google Meet call') meta.title = getMeetingTitle(meta.meetCode);
    }
    persistNow();
    if (options.meetingEnded && meta) deps.onMeetingEnded(meta, finals);
  }

  /** Resume after a page reload if a capture for this same meeting was running. */
  async function restore() {
    try {
      const stored = (await browser.storage.local.get(['isRecording', 'finalTranscripts', 'captureMeta', 'lastSubmission'])) as Partial<CaptureStorage> & { lastSubmission?: MeetingSubmission };
      submittedStartedAt = stored.lastSubmission?.startedAt ?? null;
      const storedMeta = stored.captureMeta ?? null;
      if (storedMeta && storedMeta.meetCode && storedMeta.meetCode === getMeetCode()) {
        meta = storedMeta;
        finals = Array.isArray(stored.finalTranscripts) ? stored.finalTranscripts : [];
        turnCounter = finals.length;
        if (stored.isRecording) start({ resume: true });
      } else if (stored.isRecording) {
        // A capture was left running for another meeting/tab that is gone; mark it stopped.
        await browser.storage.local.set({ isRecording: false, partialTranscript: null, captionsOn: false });
      }
    } catch {
      // storage unavailable
    }
  }

  // Never append to a transcript that has already been sent for analysis.
  browser.storage.onChanged.addListener((changes, area) => {
    const next = changes.lastSubmission?.newValue as MeetingSubmission | undefined;
    if (area === 'local' && next) submittedStartedAt = next.startedAt;
  });

  // Save what we have if the tab is closed or reloaded mid-capture. A reload resumes via restore();
  // a closed tab is detected by the background, which then submits the meeting.
  window.addEventListener('pagehide', () => {
    if (capturing) {
      commitAll();
      persistNow();
    }
  });

  return { start, stop, restore };
}
