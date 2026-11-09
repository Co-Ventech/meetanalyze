import type { SpeakerInfo, SpeakerInterval, RecentJoiner } from './common/types';
import {
  MEET_SELECTORS,
  UI_BLACKLIST,
  JOIN_NOTIFICATION_PATTERNS,
  LEAVE_NOTIFICATION_PATTERNS,
} from './utils/meet-selectors';

export default defineContentScript({
  matches: ['*://meet.google.com/*'],
  main() {
    console.log('[MeetAnalyze] Google Meet Speaker Detection content script loaded.');

    // Cache the detected real name of the local user so it persists across DOM shifts
    let cachedSelfName = '';

    // Helper to sanitize extracted participant names
    const cleanName = (name: string): string => {
      if (!name) return '';
      return name
        .replace(/\s*\((?:You|you|Presentation|Screen)\)\s*$/i, '')
        .replace(/^\s*\((?:You|you)\)\s*/i, '')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Validate that a DOM element is a genuine participant name container, not an icon or action button
    const isValidNameElement = (el: Element | null | undefined): boolean => {
      if (!el) return false;

      // Icon tags are never participant names
      const tagName = el.tagName.toLowerCase();
      if (tagName === 'i') return false;

      // Hidden elements or icon markers are never participant names
      if (el.getAttribute('aria-hidden') === 'true') return false;

      // Participant names are never inside buttons
      if (el.closest('button, [role="button"]') !== null) return false;

      // Material Icon / Symbol font classes
      const classList = typeof el.className === 'string' ? el.className.toLowerCase() : '';
      if (
        classList.includes('google-material-icons') ||
        classList.includes('material-icons') ||
        classList.includes('material-symbols')
      ) {
        return false;
      }

      if (el.closest('.google-material-icons, .material-icons, .material-symbols-outlined') !== null) {
        return false;
      }

      return true;
    };

    // Ignore non-participant UI strings, icon ligatures, and buttons
    const isInvalidName = (str: string): boolean => {
      if (!str || str.length < 2 || str.length > 50) return true;
      const lower = str.toLowerCase().trim();

      // Material Icon ligatures in Google Meet are snake_case (e.g. frame_person, visual_effects, more_vert)
      // Real human participant names never contain underscores
      if (/_/.test(lower)) return true;

      // Filter out pure timestamps (e.g. "12:34 PM") or numbers
      if (/^\d{1,2}:\d{2}(\s*(?:am|pm))?$/i.test(lower)) return true;
      if (/^\d+$/.test(lower)) return true;

      // Check blacklist
      if (UI_BLACKLIST.some((b) => lower === b || lower.startsWith(`${b}:`))) {
        return true;
      }

      return false;
    };

    // 1. Detect the local user's real name
    function getSelfName(): string {
      // Strategy A: Direct [data-self-name] attribute (Google Meet's primary self indicator)
      const selfEls = document.querySelectorAll('[data-self-name]');
      for (const el of selfEls) {
        const val = el.getAttribute('data-self-name')?.trim();
        if (val && !isInvalidName(val)) {
          const cleaned = cleanName(val);
          if (cleaned && cleaned.toLowerCase() !== 'you') {
            cachedSelfName = cleaned;
            return cleaned;
          }
        }
      }

      // Strategy B: Tile with self requested ID or containing "(You)"
      const candidates = document.querySelectorAll(
        `[aria-label*="(You)" i], div[data-requested-participant-id]`
      );

      for (const el of candidates) {
        const text = el.textContent?.trim() || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const selfAttr = el.getAttribute('data-self-name') || '';

        const source = selfAttr || (/\((?:You|you)\)/i.test(text) ? text : ariaLabel);
        if (source) {
          const matched = source.match(/^(.+?)\s*\((?:You|you)\)/i);
          const rawName = matched ? matched[1] : source;
          const cleaned = cleanName(rawName || '');
          if (cleaned && !isInvalidName(cleaned) && cleaned.toLowerCase() !== 'you') {
            cachedSelfName = cleaned;
            return cleaned;
          }
        }
      }

      // Strategy C: Check Google Account avatar button in top-right
      const accountBtn = document.querySelector(MEET_SELECTORS.googleAccountBtn);
      const label = accountBtn?.getAttribute('aria-label') || '';
      const match = label.match(/Google Account:\s*([^(\n\r]+)/i);
      if (match && match[1]) {
        const cleaned = cleanName(match[1]);
        if (cleaned && !isInvalidName(cleaned) && cleaned.toLowerCase() !== 'you') {
          cachedSelfName = cleaned;
          return cleaned;
        }
      }

      // Fallback: If we had a previously detected real name, preserve it
      if (cachedSelfName && cachedSelfName !== 'You') {
        return cachedSelfName;
      }

      return MEET_SELECTORS.fallbackAgentLabel;
    }

    // Track processed toast elements to prevent re-processing identical notifications
    const processedToastNodes = new WeakSet<Element>();

    // Explicit leave handler when a participant leave toast appears in Meet
    function handleExplicitParticipantLeave(name: string) {
      const normalized = cleanName(name);
      if (!normalized || isInvalidName(normalized)) return;

      const matched = Array.from(knownGuests).find(
        (g) => g.toLowerCase() === normalized.toLowerCase()
      );
      const target = matched || normalized;

      if (knownGuests.has(target) || announcedJoins.has(target)) {
        knownGuests.delete(target);
        lastSeenTimestamp.delete(target);
        announcedJoins.delete(target);

        try {
          browser.runtime?.sendMessage?.({
            type: 'PARTICIPANTS_LEFT',
            left: [target],
            roster: Array.from(knownGuests),
          }).catch(() => { });
        } catch { }
      }
    }

    // 2. Detect all participants in the meeting
    function getParticipants(selfName: string): { all: string[]; guests: string[] } {
      const names = new Set<string>();

      // Build selfAliases to guarantee local user is excluded from guests
      const selfAliases = new Set<string>([
        'you',
        'client',
        selfName.toLowerCase(),
      ]);
      if (cachedSelfName) {
        selfAliases.add(cachedSelfName.toLowerCase());
      }

      // Strategy A: [data-self-name] attributes represent the local user
      document.querySelectorAll('[data-self-name]').forEach((el) => {
        const val = el.getAttribute('data-self-name')?.trim();
        if (val && !isInvalidName(val)) {
          const cleaned = cleanName(val);
          if (cleaned && cleaned.toLowerCase() !== 'you') {
            cachedSelfName = cleaned;
            selfAliases.add(cleaned.toLowerCase());
          }
        }
      });

      // Strategy B: Video tiles
      document.querySelectorAll(MEET_SELECTORS.tiles).forEach((tile) => {
        // Check if this tile belongs to the local user
        const isSelfTile =
          tile.hasAttribute('data-requested-participant-id') ||
          tile.querySelector('[data-self-name]') !== null ||
          tile.querySelector('[aria-label*="(You)" i]') !== null ||
          (tile.getAttribute('aria-label') || '').toLowerCase().includes('(you)');

        if (isSelfTile) {
          // Extract and cache local user's name if available, but never add as guest
          const selfNode = tile.querySelector('div.zWGUkf, [data-self-name], [role="heading"][aria-level="3"]');
          const raw = selfNode?.getAttribute('data-self-name') || selfNode?.textContent?.trim() || '';
          const cleaned = cleanName(raw);
          if (cleaned && !isInvalidName(cleaned) && cleaned.toLowerCase() !== 'you') {
            cachedSelfName = cleaned;
            selfAliases.add(cleaned.toLowerCase());
          }
          return;
        }

        // Remote participant tile: find display name container
        let tileName: string | null = null;

        // Primary Google Meet name container
        const nameNode = tile.querySelector('div.zWGUkf, [role="heading"][aria-level="3"]');
        if (nameNode && isValidNameElement(nameNode)) {
          const text = nameNode.textContent?.trim();
          if (text && !isInvalidName(text)) {
            tileName = text;
          }
        }

        // Secondary: non-icon span / div
        if (!tileName) {
          const spanNodes = tile.querySelectorAll('span.notranslate, div.notranslate');
          for (const span of spanNodes) {
            if (isValidNameElement(span)) {
              const text = span.textContent?.trim();
              if (text && !isInvalidName(text)) {
                tileName = text;
                break;
              }
            }
          }
        }

        // Tertiary: Action buttons with participant name in aria-label
        if (!tileName) {
          const moreOptionsBtn = tile.querySelector(MEET_SELECTORS.moreOptionsBtn);
          if (moreOptionsBtn) {
            const label = moreOptionsBtn.getAttribute('aria-label') || '';
            const m = label.match(/More options for\s+(.+)$/i);
            if (m && m[1] && !isInvalidName(m[1])) {
              tileName = m[1];
            }
          }
        }

        if (!tileName) {
          const pinBtn = tile.querySelector(MEET_SELECTORS.pinBtn);
          if (pinBtn) {
            const label = pinBtn.getAttribute('aria-label') || '';
            const m = label.match(/Pin\s+([^to\n]+?)(?:\s+to\s+.*)?$/i);
            if (m && m[1] && !isInvalidName(m[1])) {
              tileName = m[1];
            }
          }
        }

        if (!tileName) {
          const muteBtn = tile.querySelector(MEET_SELECTORS.muteBtn);
          if (muteBtn) {
            const label = muteBtn.getAttribute('aria-label') || '';
            const m = label.match(/Mute\s+(.+)$/i);
            if (m && m[1] && !isInvalidName(m[1])) {
              tileName = m[1];
            }
          }
        }

        if (!tileName) {
          const videoLabels = tile.querySelectorAll(MEET_SELECTORS.videoLabelElements);
          for (const el of videoLabels) {
            const label = el.getAttribute('aria-label') || '';
            const m = label.match(/^(.+?)(?:'s|’s)\s+(?:video|screen)/i);
            if (m && m[1] && !isInvalidName(m[1])) {
              tileName = m[1];
              break;
            }
          }
        }

        if (!tileName) {
          const avatarImg = tile.querySelector(MEET_SELECTORS.avatarImg);
          if (avatarImg) {
            const alt = avatarImg.getAttribute('alt') || '';
            if (alt && !isInvalidName(alt) && !alt.toLowerCase().includes('avatar')) {
              tileName = alt;
            }
          }
        }

        if (tileName) {
          const cleaned = cleanName(tileName);
          if (cleaned && !isInvalidName(cleaned) && !selfAliases.has(cleaned.toLowerCase())) {
            names.add(cleaned);
          }
        }
      });

      // Strategy C: People sidebar panel (if rendered in DOM)
      document.querySelectorAll(MEET_SELECTORS.peopleListItems).forEach((el) => {
        if (!isValidNameElement(el)) return;

        const isSelfItem =
          el.hasAttribute('data-self-name') ||
          el.closest('[data-self-name]') !== null ||
          el.textContent?.includes('(You)') ||
          (el.getAttribute('aria-label') || '').includes('(You)');

        const text = el.getAttribute('data-self-name') || el.textContent?.trim() || '';
        const cleaned = cleanName(text);

        if (cleaned && !isInvalidName(cleaned)) {
          if (isSelfItem) {
            if (cleaned.toLowerCase() !== 'you') {
              cachedSelfName = cleaned;
              selfAliases.add(cleaned.toLowerCase());
            }
          } else if (!selfAliases.has(cleaned.toLowerCase())) {
            names.add(cleaned);
          }
        }
      });

      // Strategy D: Join & Leave notification toasts & snackbars (checked once per toast node)
      document.querySelectorAll(MEET_SELECTORS.toastAlerts).forEach((el) => {
        if (processedToastNodes.has(el)) return;
        const text = el.textContent?.trim() || '';
        if (!text) return;

        // Check Join Notification
        for (const pattern of JOIN_NOTIFICATION_PATTERNS) {
          const m = text.match(pattern);
          if (m && m[1]) {
            const cleaned = cleanName(m[1]);
            if (cleaned && !isInvalidName(cleaned) && !selfAliases.has(cleaned.toLowerCase())) {
              processedToastNodes.add(el);
              names.add(cleaned);
              break;
            }
          }
        }

        // Check Leave Notification
        for (const pattern of LEAVE_NOTIFICATION_PATTERNS) {
          const m = text.match(pattern);
          if (m && m[1]) {
            const cleaned = cleanName(m[1]);
            if (cleaned && !isInvalidName(cleaned)) {
              processedToastNodes.add(el);
              handleExplicitParticipantLeave(cleaned);
              break;
            }
          }
        }
      });

      const all = Array.from(names);
      const guests = all.filter((n) => {
        const lower = n.toLowerCase();
        return !selfAliases.has(lower) && !lower.endsWith('(you)');
      });

      return { all, guests };
    }

    // 3a. Meet live captions -> speaker timeline (most reliable name signal in the DOM)
    // Each caption block carries the speaker's display name. We record when a block first
    // appears and when its text last changed, which approximates when that person spoke.
    interface CaptionEntry {
      speaker: string;
      isSelf: boolean;
      start: number;
      end: number;
      lastText: string;
    }
    const captionEntryByBlock = new WeakMap<Element, CaptionEntry>();
    const captionEntries: CaptionEntry[] = [];
    // Captions lag speech by roughly a second; shift caption start earlier to compensate
    const CAPTION_LEAD_MS = 1200;

    function findCaptionBlock(speakerEl: Element, container: Element): Element {
      let block: Element = speakerEl;
      while (
        block.parentElement &&
        block.parentElement !== container &&
        block.parentElement.querySelectorAll(MEET_SELECTORS.captionSpeakers).length === 1
      ) {
        block = block.parentElement;
      }
      return block;
    }

    // First element (in document order) under root that holds text directly and isn't an icon
    function firstTextLeaf(root: Element): Element | null {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode() as Element | null;
      while (node) {
        if (
          node.childElementCount === 0 &&
          node.tagName !== 'IMG' &&
          (node.textContent || '').trim() &&
          isValidNameElement(node)
        ) {
          return node;
        }
        node = walker.nextNode() as Element | null;
      }
      return null;
    }

    // Outermost caption containers (ignore buttons/menu items that merely mention captions)
    function findCaptionContainers(): Element[] {
      const candidates = Array.from(document.querySelectorAll(MEET_SELECTORS.captionContainer)).filter(
        (el) => el.tagName !== 'BUTTON' && !el.closest('button, [role="button"], [role="menuitem"], [role="menu"]')
      );
      return candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
    }

    /**
     * Find (speaker name element, caption block) pairs. Uses known Meet classes first, then a
     * structural fallback that survives class renames: every caption block starts with the
     * speaker's avatar <img>, followed by the name, followed by the spoken text.
     */
    function extractCaptionPairs(container: Element): { nameEl: Element; block: Element }[] {
      const pairs: { nameEl: Element; block: Element }[] = [];
      const seenBlocks = new Set<Element>();

      container.querySelectorAll(MEET_SELECTORS.captionSpeakers).forEach((nameEl) => {
        const block = findCaptionBlock(nameEl, container);
        if (seenBlocks.has(block)) return;
        seenBlocks.add(block);
        pairs.push({ nameEl, block });
      });
      if (pairs.length > 0) return pairs;

      container.querySelectorAll('img').forEach((img) => {
        let block: Element | null = img.parentElement;
        for (let depth = 0; block && depth < 6; depth++) {
          const nameEl = firstTextLeaf(block);
          const nameText = nameEl?.textContent?.trim() || '';
          const blockText = (block.textContent || '').trim();
          // A block holds both the name and some caption text after it
          if (nameEl && nameText && blockText.length > nameText.length) {
            if (!seenBlocks.has(block)) {
              seenBlocks.add(block);
              pairs.push({ nameEl, block });
            }
            return;
          }
          if (block === container) return;
          block = block.parentElement;
        }
      });
      return pairs;
    }

    let captionDiag = { containers: 0, blocks: 0, lastLog: 0 };

    function scanCaptions(selfName: string) {
      const containers = findCaptionContainers();
      captionDiag.containers = containers.length;
      captionDiag.blocks = 0;
      if (containers.length === 0) return;
      const now = Date.now();
      const selfLower = selfName.toLowerCase();

      for (const container of containers) {
        for (const { nameEl, block } of extractCaptionPairs(container)) {
          const rawName = nameEl.textContent?.trim() || '';
          const name = cleanName(rawName);
          if (!name || isInvalidName(name)) continue;

          const fullText = block.textContent || '';
          const text = fullText.replace(rawName, '').trim();
          if (!text) continue;
          captionDiag.blocks++;

          const isSelf =
            name.toLowerCase() === 'you' ||
            name.toLowerCase() === selfLower ||
            (!!cachedSelfName && name.toLowerCase() === cachedSelfName.toLowerCase());

          const existing = captionEntryByBlock.get(block);
          if (!existing || existing.speaker !== name) {
            const entry: CaptionEntry = {
              speaker: name,
              isSelf,
              start: now - CAPTION_LEAD_MS,
              end: now,
              lastText: text,
            };
            captionEntryByBlock.set(block, entry);
            captionEntries.push(entry);
          } else if (existing.lastText !== text) {
            existing.lastText = text;
            existing.end = now;
          }
        }
      }

      // Prune caption entries older than 60 seconds
      const cutoff = now - 60000;
      while (captionEntries.length > 0 && (captionEntries[0]?.end ?? 0) < cutoff) {
        captionEntries.shift();
      }
    }

    function getCaptionIntervals(): SpeakerInterval[] {
      return captionEntries.map((e) => ({
        speaker: e.speaker,
        start: e.start,
        end: e.end + 300,
        source: 'captions' as const,
        isSelf: e.isSelf,
      }));
    }

    // 3b. Detect the active speaker in real-time
    function getActiveSpeaker(selfName: string): string | null {
      // Strategy A: Most recently updated caption block (within the last 1.5s)
      const now = Date.now();
      for (let i = captionEntries.length - 1; i >= 0; i--) {
        const entry = captionEntries[i];
        if (entry && now - entry.end < 1500) {
          return entry.isSelf ? selfName : entry.speaker;
        }
      }

      // Strategy B: Explicit speaking indicators on video tiles.
      // (Border colour and "unmuted" checks were removed: Meet draws its ring with an overlay,
      // and unmuted does not mean speaking, so both produced false positives.)
      const tiles = document.querySelectorAll(MEET_SELECTORS.tiles);
      for (const tile of tiles) {
        const isSpeakingAria = !!tile.querySelector(
          '[aria-label*="is speaking" i], [aria-label*="is talking" i]'
        );
        const isSpeakingClass =
          tile.classList.contains('speaking') ||
          !!tile.querySelector('[data-is-speaking="true"]');

        if (isSpeakingAria || isSpeakingClass) {
          // If this is the self tile, the active speaker is self
          const isSelfTile =
            tile.hasAttribute('data-requested-participant-id') ||
            tile.querySelector('[data-self-name]') !== null ||
            tile.querySelector('[aria-label*="(You)" i]') !== null ||
            (tile.getAttribute('aria-label') || '').toLowerCase().includes('(you)');

          if (isSelfTile) {
            return selfName;
          }

          // Remote tile: extract name safely
          let speakerName: string | null = null;
          const nameNode = tile.querySelector('div.zWGUkf, [role="heading"][aria-level="3"]');
          if (nameNode && isValidNameElement(nameNode)) {
            speakerName = nameNode.textContent?.trim() || null;
          }

          if (!speakerName) {
            const spanNodes = tile.querySelectorAll('span.notranslate, div.notranslate');
            for (const span of spanNodes) {
              if (isValidNameElement(span)) {
                const text = span.textContent?.trim();
                if (text && !isInvalidName(text)) {
                  speakerName = text;
                  break;
                }
              }
            }
          }

          if (!speakerName) {
            const moreOptionsBtn = tile.querySelector(MEET_SELECTORS.moreOptionsBtn);
            if (moreOptionsBtn) {
              const label = moreOptionsBtn.getAttribute('aria-label') || '';
              const m = label.match(/More options for\s+(.+)$/i);
              if (m && m[1] && !isInvalidName(m[1])) {
                speakerName = m[1];
              }
            }
          }

          if (speakerName) {
            const cleaned = cleanName(speakerName);
            if (cleaned && !isInvalidName(cleaned)) {
              return cleaned;
            }
          }
        }
      }

      return null;
    }

    // Rolling log of timestamped speaker events: { speaker, start, end }
    const recentIntervals: SpeakerInterval[] = [];
    let currentInterval: { speaker: string; start: number } | null = null;

    function recordSpeakerActivity(activeSpeaker: string | null, selfName: string) {
      const now = Date.now();
      const isSelfName = (n: string) => n.toLowerCase() === selfName.toLowerCase() || n.toLowerCase() === 'you';

      if (activeSpeaker) {
        if (!currentInterval || currentInterval.speaker !== activeSpeaker) {
          // Conclude previous interval
          if (currentInterval) {
            recentIntervals.push({
              speaker: currentInterval.speaker,
              start: currentInterval.start,
              end: now,
              source: 'active',
              isSelf: isSelfName(currentInterval.speaker),
            });
          }
          currentInterval = { speaker: activeSpeaker, start: now };
        }
      } else {
        if (currentInterval && now - currentInterval.start > 800) {
          recentIntervals.push({
            speaker: currentInterval.speaker,
            start: currentInterval.start,
            end: now,
            source: 'active',
            isSelf: isSelfName(currentInterval.speaker),
          });
          currentInterval = null;
        }
      }

      // Prune intervals older than 60 seconds to keep memory minimal
      const cutoff = now - 60000;
      while (recentIntervals.length > 0 && (recentIntervals[0]?.end ?? 0) < cutoff) {
        recentIntervals.shift();
      }
    }

    // 3c. Auto-enable Meet captions while recording, hidden from view
    const CAPTION_HIDE_STYLE_ID = 'meetanalyze-hide-captions';
    let captionsEnabledByUs = false;

    function areCaptionsOn(): boolean {
      return !!document.querySelector(MEET_SELECTORS.captionsOffBtn);
    }

    function hideCaptions() {
      if (document.getElementById(CAPTION_HIDE_STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = CAPTION_HIDE_STYLE_ID;
      // Keep the caption region in the DOM (so Meet keeps rendering it) but invisible
      style.textContent = `
        [role="region"][aria-label*="caption" i], [jsname="dsZIyd"], .nMcdL.bj4p3b {
          opacity: 0 !important;
          pointer-events: none !important;
          position: fixed !important;
          left: -10000px !important;
          bottom: 0 !important;
        }
      `;
      document.head.appendChild(style);
    }

    function showCaptions() {
      document.getElementById(CAPTION_HIDE_STYLE_ID)?.remove();
    }

    function pressCaptionsShortcut() {
      // Meet's keyboard shortcut for captions is "c". Synthetic events may be ignored; best-effort.
      const opts = { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true };
      document.body.dispatchEvent(new KeyboardEvent('keydown', opts));
      document.body.dispatchEvent(new KeyboardEvent('keyup', opts));
    }

    function enableCaptionsForRecording(attempt = 0) {
      if (areCaptionsOn()) {
        // Only hide captions we turned on ourselves; respect captions the user chose to see
        if (captionsEnabledByUs) hideCaptions();
        return;
      }
      const btn = document.querySelector<HTMLButtonElement>(MEET_SELECTORS.captionsOnBtn);
      if (btn) {
        btn.click();
      } else if (attempt === 0) {
        pressCaptionsShortcut();
      }
      captionsEnabledByUs = true;
      hideCaptions();
      // Verify and retry for a few seconds (control bar may be hidden or still loading)
      if (attempt < 5) {
        setTimeout(() => {
          if (!areCaptionsOn()) enableCaptionsForRecording(attempt + 1);
        }, 1000);
      }
    }

    // Log caption-reading health every 10s while recording (visible in the Meet tab's DevTools console)
    let captionDiagTimer: ReturnType<typeof setInterval> | null = null;
    function startCaptionDiagnostics() {
      if (captionDiagTimer) return;
      captionDiagTimer = setInterval(() => {
        const on = areCaptionsOn();
        const latest = captionEntries[captionEntries.length - 1];
        console.log(
          `[MeetAnalyze captions] captionsOn=${on} containers=${captionDiag.containers} blocks=${captionDiag.blocks}` +
            ` entries=${captionEntries.length} latest=${latest ? `${latest.speaker} (${Math.round((Date.now() - latest.end) / 1000)}s ago)` : 'none'}`
        );
        if (on && captionDiag.containers > 0 && captionDiag.blocks === 0 && captionEntries.length === 0) {
          const c = findCaptionContainers()[0];
          console.log('[MeetAnalyze captions] caption container found but no speaker blocks parsed. HTML:', c?.outerHTML.slice(0, 3000));
        }
      }, 10000);
    }

    function restoreCaptionsAfterRecording() {
      if (captionDiagTimer) {
        clearInterval(captionDiagTimer);
        captionDiagTimer = null;
      }
      if (captionsEnabledByUs && areCaptionsOn()) {
        document.querySelector<HTMLButtonElement>(MEET_SELECTORS.captionsOffBtn)?.click();
      }
      captionsEnabledByUs = false;
      showCaptions();
    }

    // Track participants dynamically across session
    const knownGuests = new Set<string>();
    const announcedJoins = new Set<string>();
    const lastSeenTimestamp = new Map<string, number>();
    let recentJoiners: RecentJoiner[] = [];
    let isInitialBaselineEstablished = false;
    let baselineTickCount = 0;

    // Current cached state
    let cachedSpeakerInfo: SpeakerInfo = {
      selfName: 'You',
      activeSpeaker: null,
      allParticipants: [],
      guests: [],
      intervals: [],
      recentJoiners: [],
    };

    function collectSpeakerInfo(): SpeakerInfo {
      const selfName = getSelfName();
      const { all: scannedAll, guests: scannedGuests } = getParticipants(selfName);
      scanCaptions(selfName);
      const activeSpeaker = getActiveSpeaker(selfName);

      recordSpeakerActivity(activeSpeaker, selfName);

      const now = Date.now();
      const newlyJoined: string[] = [];
      const leftParticipants: string[] = [];

      // Build selfAliases to ensure local user & invalid names are continuously purged from knownGuests
      const selfAliases = new Set<string>([
        'you',
        'client',
        selfName.toLowerCase(),
      ]);
      if (cachedSelfName) {
        selfAliases.add(cachedSelfName.toLowerCase());
      }

      // Continuously purge any invalid names, Material Icon ligatures, or self names from knownGuests
      for (const known of Array.from(knownGuests)) {
        if (isInvalidName(known) || selfAliases.has(known.toLowerCase()) || known.toLowerCase().endsWith('(you)')) {
          knownGuests.delete(known);
          lastSeenTimestamp.delete(known);
          announcedJoins.delete(known);
        }
      }

      // 1. Mark observed guests as seen right now and add to knownGuests
      for (const guest of scannedGuests) {
        if (!isInvalidName(guest) && !selfAliases.has(guest.toLowerCase())) {
          lastSeenTimestamp.set(guest, now);
          knownGuests.add(guest);
        }
      }

      // 2. Establish initial session baseline without firing "joined" tags for pre-existing attendees
      if (!isInitialBaselineEstablished) {
        baselineTickCount++;
        for (const guest of scannedGuests) {
          announcedJoins.add(guest);
        }
        if (baselineTickCount >= 3 || scannedGuests.length > 0) {
          isInitialBaselineEstablished = true;
        }
      } else {
        // Baseline established: ONLY notify if a GENUINELY NEW person joins the call
        for (const guest of scannedGuests) {
          if (!announcedJoins.has(guest)) {
            announcedJoins.add(guest);
            newlyJoined.push(guest);
            recentJoiners.push({ name: guest, joinedAt: now });
          }
        }
      }

      // 3. Mark as left ONLY if absent continuously for > 45 seconds (never during active speaking!)
      for (const known of Array.from(knownGuests)) {
        const lastSeen = lastSeenTimestamp.get(known) || 0;
        if (now - lastSeen > 45000) {
          knownGuests.delete(known);
          lastSeenTimestamp.delete(known);
          announcedJoins.delete(known);
          leftParticipants.push(known);
        }
      }

      // Prune recent joiners older than 15 seconds
      recentJoiners = recentJoiners.filter((j) => now - j.joinedAt < 15000);

      // Stable roster of guests who are in the call
      const stableGuests = Array.from(knownGuests);

      // Current active interval extended to now, plus caption-derived intervals
      const activeSnapshot: SpeakerInterval[] = [...recentIntervals];
      if (currentInterval) {
        activeSnapshot.push({
          speaker: currentInterval.speaker,
          start: currentInterval.start,
          end: Date.now() + 1000,
          source: 'active',
          isSelf:
            currentInterval.speaker.toLowerCase() === selfName.toLowerCase() ||
            currentInterval.speaker.toLowerCase() === 'you',
        });
      }
      activeSnapshot.push(...getCaptionIntervals());

      return {
        selfName,
        activeSpeaker,
        allParticipants: [selfName, ...stableGuests],
        guests: stableGuests,
        intervals: activeSnapshot,
        recentJoiners,
        newlyJoined: newlyJoined.length > 0 ? newlyJoined : undefined,
        leftParticipants: leftParticipants.length > 0 ? leftParticipants : undefined,
      };
    }

    // Broadcast speaker info update to extension background & offscreen
    function broadcastSpeakerInfo() {
      const info = collectSpeakerInfo();

      const hasChanged =
        info.selfName !== cachedSpeakerInfo.selfName ||
        info.activeSpeaker !== cachedSpeakerInfo.activeSpeaker ||
        info.guests.length !== cachedSpeakerInfo.guests.length ||
        info.allParticipants.length !== cachedSpeakerInfo.allParticipants.length ||
        (info.intervals && info.intervals.length !== cachedSpeakerInfo.intervals?.length) ||
        (info.newlyJoined && info.newlyJoined.length > 0) ||
        (info.leftParticipants && info.leftParticipants.length > 0) ||
        !info.guests.every((g, i) => g === cachedSpeakerInfo.guests[i]);

      cachedSpeakerInfo = info;

      if (hasChanged) {
        try {
          browser.runtime?.sendMessage?.({
            type: 'SPEAKER_INFO_UPDATED',
            speakerInfo: info,
          }).catch(() => { });

          if (info.newlyJoined && info.newlyJoined.length > 0) {
            browser.runtime?.sendMessage?.({
              type: 'PARTICIPANTS_JOINED',
              joined: info.newlyJoined,
              roster: info.guests,
            }).catch(() => { });
          }

          if (info.leftParticipants && info.leftParticipants.length > 0) {
            browser.runtime?.sendMessage?.({
              type: 'PARTICIPANTS_LEFT',
              left: info.leftParticipants,
              roster: info.guests,
            }).catch(() => { });
          }
        } catch {
          // Extension context reloading
        }
      }
    }

    // Periodically sync and observe DOM mutations
    const pollInterval = setInterval(broadcastSpeakerInfo, 600);

    // MutationObserver to catch immediate active speaker changes & new participants joining
    let debounceTimer: any = null;
    const observer = new MutationObserver((mutations) => {
      const hasStructureChange = mutations.some((m) => m.type === 'childList');
      const delay = hasStructureChange ? 80 : 180;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(broadcastSpeakerInfo, delay);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'data-is-speaking', 'class', 'style', 'data-self-name'],
    });

    // Handle incoming messages
    browser.runtime.onMessage.addListener(
      (message: unknown, _sender: unknown, sendResponse: (res?: unknown) => void) => {
        const msg = message as { type?: string } | undefined;

        if (msg?.type === 'MEET_CONNECTION_CHECK') {
          const info = collectSpeakerInfo();
          sendResponse({
            connected: true,
            message: 'Connected to Google Meet',
            speakerInfo: info,
          });
          return true;
        }

        if (msg?.type === 'MEETANALYZE_RECORDING_STARTED') {
          enableCaptionsForRecording();
          startCaptionDiagnostics();
          sendResponse({ success: true });
          return true;
        }

        if (msg?.type === 'MEETANALYZE_RECORDING_STOPPED') {
          restoreCaptionsAfterRecording();
          sendResponse({ success: true });
          return true;
        }

        if (msg?.type === 'GET_SPEAKER_INFO') {
          const info = collectSpeakerInfo();
          cachedSpeakerInfo = info;
          sendResponse(info);
          return true;
        }

        return false;
      }
    );

    // Initial broadcast
    setTimeout(broadcastSpeakerInfo, 800);
  },
});
