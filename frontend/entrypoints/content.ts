export default defineContentScript({
  matches: ['*://meet.google.com/*'],
  main() {
    console.log('[MeetAnalyze] Content script loaded on Google Meet.');

    // Helper to clean extracted text
    const cleanName = (name: string): string => {
      return name
        .replace(/\s*\((You|you|Presentation|Screen)\)$/i, '')
        .replace(/\n+/g, ' ')
        .trim();
    };

    // Ignore non-participant UI strings
    const isInvalidName = (str: string): boolean => {
      if (!str || str.length < 2 || str.length > 50) return true;
      const lower = str.toLowerCase();
      const blacklist = [
        'turn on captions',
        'turn off captions',
        'turn on microphone',
        'turn off microphone',
        'leave call',
        'meeting details',
        'people',
        'chat',
        'activities',
        'more options',
        'pin to screen',
        'presentation',
      ];
      return blacklist.some((b) => lower.includes(b));
    };

    // 1. Detect the local user's own name
    function getSelfName(): string {
      // Check explicit data-self-name
      const selfEl = document.querySelector('[data-self-name]');
      const dataSelfName = selfEl?.getAttribute('data-self-name');
      if (dataSelfName && !isInvalidName(dataSelfName)) {
        return cleanName(dataSelfName);
      }

      // Check Google Account avatar in top bar
      const accountBtn = document.querySelector(
        'a[aria-label*="Google Account" i], button[aria-label*="Google Account" i]'
      );
      const label = accountBtn?.getAttribute('aria-label') || '';
      const match = label.match(/Google Account:\s*([^(\n]+)/i);
      if (match && match[1] && !isInvalidName(match[1])) {
        return cleanName(match[1]);
      }

      // Look for any element ending in (You)
      const allTextEls = document.querySelectorAll('span, div');
      for (const el of allTextEls) {
        const text = el.textContent?.trim() || '';
        if (/\((you|You)\)$/.test(text) && text.length < 40) {
          const name = cleanName(text);
          if (!isInvalidName(name)) return name;
        }
      }

      return 'You';
    }

    // 2. Detect all participants in the meeting
    function getParticipants(): string[] {
      const names = new Set<string>();

      // From data-self-name attributes
      document.querySelectorAll('[data-self-name]').forEach((el) => {
        const val = el.getAttribute('data-self-name');
        if (val && !isInvalidName(val)) names.add(cleanName(val));
      });

      // From participant video tiles
      document.querySelectorAll('[data-participant-id]').forEach((tile) => {
        // Find text nodes inside tile
        const textEls = tile.querySelectorAll('span, div');
        for (const el of textEls) {
          const text = el.textContent?.trim() || '';
          if (text.length >= 2 && text.length <= 40 && !isInvalidName(text)) {
            // If it looks like a participant name
            if (!text.includes('(') || text.includes('(You)')) {
              names.add(cleanName(text));
              break;
            }
          }
        }
      });

      // From people sidebar panel (if open)
      document.querySelectorAll('[role="listitem"]').forEach((item) => {
        const text = item.textContent?.trim() || '';
        const firstLine = text.split('\n')[0]?.trim();
        if (firstLine && !isInvalidName(firstLine)) {
          names.add(cleanName(firstLine));
        }
      });

      return Array.from(names);
    }

    // 3. Detect the active speaker in real-time from the Google Meet DOM
    function getActiveSpeaker(): string | null {
      // Strategy A: Check Closed Captions (if enabled, captions have exact speaker attribution)
      const captionContainer = document.querySelector(
        '[role="region"][aria-label*="caption" i], [aria-label*="Closed captions" i]'
      );
      if (captionContainer) {
        // Last row in captions is the latest active speaker
        const captionRows = captionContainer.querySelectorAll('div, span');
        for (let i = captionRows.length - 1; i >= 0; i--) {
          const rowText = captionRows[i]?.textContent?.trim() || '';
          // Captions usually prefix text with "Name: Hello" or separate container
          const match = rowText.match(/^([^:\n]{2,30}):/);
          if (match && match[1] && !isInvalidName(match[1])) {
            return cleanName(match[1]);
          }
        }
      }

      // Strategy B: Check video tiles for active speaker indicator
      const tiles = document.querySelectorAll('[data-participant-id]');
      for (const tile of tiles) {
        // Check speaking aria-label
        const isSpeakingAria = !!tile.querySelector(
          '[aria-label*="speaking" i], [aria-label*="is talking" i]'
        );
        // Check if tile has active visualizer or speaking border/attribute
        const isSpeakingAttr =
          tile.getAttribute('data-is-speaking') === 'true' ||
          tile.classList.contains('speaking') ||
          isSpeakingAria;

        if (isSpeakingAttr) {
          const tileText = tile.textContent?.trim() || '';
          const firstLine = tileText.split('\n')[0]?.trim();
          if (firstLine && !isInvalidName(firstLine)) {
            return cleanName(firstLine);
          }
        }
      }

      return null;
    }

    // Handle messages from extension background/offscreen
    browser.runtime.onMessage.addListener(
      (message: unknown, _sender: unknown, sendResponse: (res?: unknown) => void) => {
        const msg = message as { type?: string } | undefined;

        if (msg && msg.type === 'MEET_CONNECTION_CHECK') {
          sendResponse({
            connected: true,
            message: 'Connected to Google Meet',
          });
          return true;
        }

        if (msg && msg.type === 'GET_SPEAKER_INFO') {
          const selfName = getSelfName();
          const allParticipants = getParticipants();
          const activeSpeaker = getActiveSpeaker();
          const guests = allParticipants.filter((p) => p !== selfName);

          sendResponse({
            selfName,
            activeSpeaker,
            allParticipants,
            guests,
          });
          return true;
        }

        return false;
      }
    );
  },
});
