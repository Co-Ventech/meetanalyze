import type { SpeakerInfo, SpeakerInterval, RecentJoiner } from './common/types';
import {
  MEET_SELECTORS,
  ACTIVE_SPEAKER_BORDER_COLORS,
  UI_BLACKLIST,
  JOIN_NOTIFICATION_PATTERNS,
  LEAVE_NOTIFICATION_PATTERNS,
} from './utils/meet-selectors';

export default defineContentScript({
  matches: ['*://meet.google.com/*'],
  main() {
    console.log('[MeetAnalyze] Google Meet Speaker Detection content script loaded.');

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

    // Ignore non-participant UI strings and icons
    const isInvalidName = (str: string): boolean => {
      if (!str || str.length < 2 || str.length > 50) return true;
      const lower = str.toLowerCase().trim();

      if (UI_BLACKLIST.some((b) => lower === b || lower.startsWith(`${b}:`))) {
        return true;
      }

      // Filter out pure timestamps (e.g. "12:34 PM") or numbers
      if (/^\d{1,2}:\d{2}(\s*(?:am|pm))?$/i.test(lower)) return true;
      if (/^\d+$/.test(lower)) return true;

      return false;
    };

    // 1. Detect the local user's real name
    function getSelfName(): string {
      // Strategy A: Find elements explicitly containing "(You)"
      const candidates = document.querySelectorAll(
        `[data-self-name], ${MEET_SELECTORS.nameElements}, [aria-label*="(You)" i]`
      );

      for (const el of candidates) {
        const text = el.textContent?.trim() || '';
        const ariaLabel = el.getAttribute('aria-label') || '';

        if (/\((?:You|you)\)/.test(text) || /\((?:You|you)\)/.test(ariaLabel)) {
          const matched = text.match(/^(.+?)\s*\((?:You|you)\)/) || ariaLabel.match(/^(.+?)\s*\((?:You|you)\)/);
          const rawName = matched ? matched[1] : (text || ariaLabel);
          const cleaned = cleanName(rawName || '');
          if (cleaned && !isInvalidName(cleaned)) {
            return cleaned;
          }
        }
      }

      // Strategy B: Check Google Account avatar button in top-right
      const accountBtn = document.querySelector(MEET_SELECTORS.googleAccountBtn);
      const label = accountBtn?.getAttribute('aria-label') || '';
      const match = label.match(/Google Account:\s*([^(\n]+)/i);
      if (match && match[1]) {
        const cleaned = cleanName(match[1]);
        if (cleaned && !isInvalidName(cleaned)) {
          return cleaned;
        }
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

      // Strategy A: [data-self-name] attributes on participant elements
      document.querySelectorAll('[data-self-name]').forEach((el) => {
        const val = el.getAttribute('data-self-name');
        if (val) {
          const cleaned = cleanName(val);
          if (cleaned && !isInvalidName(cleaned)) {
            names.add(cleaned);
          }
        }
      });

      // Strategy B: Video tiles
      document.querySelectorAll(MEET_SELECTORS.tiles).forEach((tile) => {
        // Display name in .notranslate or [data-self-name]
        const nameNode = tile.querySelector(MEET_SELECTORS.nameElements);
        if (nameNode) {
          const text = nameNode.textContent?.trim() || nameNode.getAttribute('data-self-name') || '';
          const cleaned = cleanName(text);
          if (cleaned && !isInvalidName(cleaned)) {
            names.add(cleaned);
          }
        }

        // Action buttons with participant name in aria-label
        const moreOptionsBtn = tile.querySelector(MEET_SELECTORS.moreOptionsBtn);
        if (moreOptionsBtn) {
          const label = moreOptionsBtn.getAttribute('aria-label') || '';
          const m = label.match(/More options for\s+(.+)$/i);
          if (m && m[1]) {
            const cleaned = cleanName(m[1]);
            if (cleaned && !isInvalidName(cleaned)) names.add(cleaned);
          }
        }

        const pinBtn = tile.querySelector(MEET_SELECTORS.pinBtn);
        if (pinBtn) {
          const label = pinBtn.getAttribute('aria-label') || '';
          const m = label.match(/Pin\s+([^to\n]+?)(?:\s+to\s+.*)?$/i);
          if (m && m[1]) {
            const cleaned = cleanName(m[1]);
            if (cleaned && !isInvalidName(cleaned)) names.add(cleaned);
          }
        }

        // Mute button aria-label
        const muteBtn = tile.querySelector(MEET_SELECTORS.muteBtn);
        if (muteBtn) {
          const label = muteBtn.getAttribute('aria-label') || '';
          const m = label.match(/Mute\s+(.+)$/i);
          if (m && m[1]) {
            const cleaned = cleanName(m[1]);
            if (cleaned && !isInvalidName(cleaned)) names.add(cleaned);
          }
        }

        // Participant video label (e.g. "Arsalan's video")
        const videoLabels = tile.querySelectorAll(MEET_SELECTORS.videoLabelElements);
        videoLabels.forEach((el) => {
          const label = el.getAttribute('aria-label') || '';
          const m = label.match(/^(.+?)(?:'s|’s)\s+(?:video|screen)/i);
          if (m && m[1]) {
            const cleaned = cleanName(m[1]);
            if (cleaned && !isInvalidName(cleaned)) names.add(cleaned);
          }
        });

        // Avatar alt attribute
        const avatarImg = tile.querySelector(MEET_SELECTORS.avatarImg);
        if (avatarImg) {
          const alt = avatarImg.getAttribute('alt') || '';
          const cleaned = cleanName(alt);
          if (cleaned && !isInvalidName(cleaned) && !cleaned.toLowerCase().includes('avatar')) {
            names.add(cleaned);
          }
        }
      });

      // Strategy C: People sidebar panel (if rendered in DOM)
      document.querySelectorAll(MEET_SELECTORS.peopleListItems).forEach((el) => {
        const text = el.textContent?.trim() || el.getAttribute('data-self-name') || '';
        const cleaned = cleanName(text);
        if (cleaned && !isInvalidName(cleaned)) {
          names.add(cleaned);
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
            if (cleaned && !isInvalidName(cleaned)) {
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
      const normalizedSelf = selfName.toLowerCase();
      const guests = all.filter((n) => {
        const lower = n.toLowerCase();
        return lower !== normalizedSelf && lower !== 'you';
      });

      return { all, guests };
    }

    // 3. Detect the active speaker in real-time
    function getActiveSpeaker(selfName: string): string | null {
      // Strategy A: Check Closed Captions
      const captionContainer = document.querySelector(MEET_SELECTORS.captionContainer);
      if (captionContainer) {
        const speakerEls = captionContainer.querySelectorAll(MEET_SELECTORS.captionSpeakers);
        if (speakerEls.length > 0) {
          const latestSpeakerEl = speakerEls[speakerEls.length - 1];
          const text = latestSpeakerEl?.textContent?.trim() || '';
          const cleaned = cleanName(text);
          if (cleaned && !isInvalidName(cleaned)) {
            return cleaned;
          }
        }
      }

      // Strategy B: Check video tiles for active speaking indicators (visualizer or blue ring)
      const tiles = document.querySelectorAll(MEET_SELECTORS.tiles);
      for (const tile of tiles) {
        const isSpeakingAria = !!tile.querySelector(
          '[aria-label*="speaking" i], [aria-label*="is talking" i], [aria-label*="unmuted" i]'
        );
        const isSpeakingClass =
          tile.classList.contains('speaking') ||
          !!tile.querySelector('[class*="speaking" i], [data-is-speaking="true"]');

        // Check for blue border/ring
        const computedStyle = window.getComputedStyle(tile);
        const borderColor = computedStyle.borderColor || '';
        const isBlueBorder = ACTIVE_SPEAKER_BORDER_COLORS.some((color) => borderColor.includes(color));

        if (isSpeakingAria || isSpeakingClass || isBlueBorder) {
          const nameNode = tile.querySelector(MEET_SELECTORS.nameElements);
          const raw = nameNode?.textContent?.trim() || nameNode?.getAttribute('data-self-name') || '';
          const cleaned = cleanName(raw);
          if (cleaned && !isInvalidName(cleaned)) {
            return cleaned;
          }
        }
      }

      return null;
    }

    // Rolling log of timestamped speaker events: { speaker, start, end }
    const recentIntervals: SpeakerInterval[] = [];
    let currentInterval: { speaker: string; start: number } | null = null;

    function recordSpeakerActivity(activeSpeaker: string | null) {
      const now = Date.now();

      if (activeSpeaker) {
        if (!currentInterval || currentInterval.speaker !== activeSpeaker) {
          // Conclude previous interval
          if (currentInterval) {
            recentIntervals.push({
              speaker: currentInterval.speaker,
              start: currentInterval.start,
              end: now,
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
          });
          currentInterval = null;
        }
      }

      // Prune intervals older than 45 seconds to keep memory minimal
      const cutoff = now - 45000;
      while (recentIntervals.length > 0 && (recentIntervals[0]?.end ?? 0) < cutoff) {
        recentIntervals.shift();
      }
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
      const activeSpeaker = getActiveSpeaker(selfName);

      recordSpeakerActivity(activeSpeaker);

      const now = Date.now();
      const newlyJoined: string[] = [];
      const leftParticipants: string[] = [];

      // 1. Mark observed guests as seen right now and add to knownGuests
      for (const guest of scannedGuests) {
        lastSeenTimestamp.set(guest, now);
        knownGuests.add(guest);
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

      // Current active interval extended to now
      const activeSnapshot: SpeakerInterval[] = [...recentIntervals];
      if (currentInterval) {
        activeSnapshot.push({
          speaker: currentInterval.speaker,
          start: currentInterval.start,
          end: Date.now() + 1000,
        });
      }

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
