import { MEET_SELECTORS, JOIN_NOTIFICATION_PATTERNS } from './utils/meet-selectors';
import { cleanName, isInvalidName, toName } from './utils/participant-names';
import { createCaptionCapture } from './utils/caption-capture';

const SELF_LABEL = 'You';
const NAME_NODE = 'div.zWGUkf, [role="heading"][aria-level="3"]';
const ICON_CLASSES = '.google-material-icons, .material-icons, [class*="material-symbols"]';

/** Rejects icons, hidden elements and anything inside a button. */
const isNameElement = (el: Element): boolean =>
  el.tagName !== 'I' &&
  el.getAttribute('aria-hidden') !== 'true' &&
  !el.closest('button, [role="button"]') &&
  !el.closest(ICON_CLASSES);

function firstName(els: Iterable<Element>, read: (el: Element) => string | null | undefined): string | null {
  for (const el of els) {
    const name = toName(read(el));
    if (name) return name;
  }
  return null;
}

const ariaMatch = (pattern: RegExp) => (el: Element) => el.getAttribute('aria-label')?.match(pattern)?.[1];
const textIfName = (el: Element) => (isNameElement(el) ? el.textContent : null);

function isSelfTile(tile: Element): boolean {
  return (
    tile.hasAttribute('data-requested-participant-id') ||
    !!tile.querySelector('[data-self-name], [aria-label*="(You)" i]') ||
    /\(you\)/i.test(tile.getAttribute('aria-label') || '')
  );
}

function tileName(tile: Element): string | null {
  const q = (selector: string) => tile.querySelectorAll(selector);
  return (
    firstName(q(NAME_NODE), textIfName) ??
    firstName(q('span.notranslate, div.notranslate'), textIfName) ??
    firstName(q(MEET_SELECTORS.moreOptionsBtn), ariaMatch(/More options for\s+(.+)$/i)) ??
    firstName(q(MEET_SELECTORS.pinBtn), ariaMatch(/^Pin\s+(.+?)(?:\s+to\s+.*)?$/i)) ??
    firstName(q(MEET_SELECTORS.muteBtn), ariaMatch(/^Mute\s+(.+)$/i)) ??
    firstName(q(MEET_SELECTORS.videoLabelElements), ariaMatch(/^(.+?)['’]s\s+(?:video|screen)/i)) ??
    firstName(q(MEET_SELECTORS.avatarImg), (el) => {
      const alt = el.getAttribute('alt');
      return alt && !/avatar/i.test(alt) ? alt : null;
    })
  );
}

export default defineContentScript({
  matches: ['*://meet.google.com/*'],
  main() {
    // Meet's DOM only shows the local user's name some of the time, so keep the last one found.
    let cachedSelfName = '';
    // Scans a scraped name has appeared in. Transient UI text (tooltips, labels mid-render) is seen
    // once; a participant's tile is there scan after scan.
    const sightings = new Map<string, number>();
    const CONFIRM_SIGHTINGS = 2;

    function findSelfName(): string | null {
      const fromAttr = firstName(document.querySelectorAll('[data-self-name]'), (el) => el.getAttribute('data-self-name'));
      if (fromAttr) return fromAttr;

      const fromTile = firstName(
        document.querySelectorAll('[aria-label*="(You)" i], div[data-requested-participant-id]'),
        (el) => {
          const text = el.textContent?.trim() || '';
          const source = /\(you\)/i.test(text) ? text : el.getAttribute('aria-label') || '';
          return source.match(/^(.+?)\s*\(you\)/i)?.[1] ?? source;
        },
      );
      if (fromTile) return fromTile;

      const label = document.querySelector(MEET_SELECTORS.googleAccountBtn)?.getAttribute('aria-label') || '';
      return toName(label.match(/Google Account:\s*([^(\n\r]+)/i)?.[1]);
    }

    function getSelfName(): string {
      const found = findSelfName();
      if (found) cachedSelfName = found;
      return cachedSelfName || SELF_LABEL;
    }

    function getParticipantNames(): string[] {
      const selfName = getSelfName();
      const selfAliases = new Set(['you', 'client', selfName.toLowerCase()]);
      const names = new Set<string>();
      const add = (name: string | null) => {
        if (name && !selfAliases.has(name.toLowerCase())) names.add(name);
      };

      for (const tile of document.querySelectorAll(MEET_SELECTORS.tiles)) {
        if (!isSelfTile(tile)) add(tileName(tile));
      }

      for (const el of document.querySelectorAll(MEET_SELECTORS.peopleListItems)) {
        if (!isNameElement(el)) continue;
        const name = toName(el.getAttribute('data-self-name') || el.textContent);
        const isSelf = !!el.closest('[data-self-name]') || /\(you\)/i.test(el.textContent || '');
        if (isSelf) {
          if (name) cachedSelfName = name;
        } else {
          add(name);
        }
      }

      const confirmed = new Set<string>();
      for (const name of names) {
        const count = (sightings.get(name) ?? 0) + 1;
        sightings.set(name, count);
        if (count >= CONFIRM_SIGHTINGS) confirmed.add(name);
      }
      names.clear();
      for (const name of confirmed) names.add(name);

      for (const el of document.querySelectorAll(MEET_SELECTORS.toastAlerts)) {
        const text = el.textContent?.trim() || '';
        for (const pattern of JOIN_NOTIFICATION_PATTERNS) {
          const name = toName(text.match(pattern)?.[1]);
          if (name) {
            add(name);
            break;
          }
        }
      }

      return [cachedSelfName, ...names].filter(Boolean);
    }

    const captions = createCaptionCapture({
      getSelfName,
      cleanName,
      isInvalidName,
      getParticipantNames,
      onMeetingEnded: (meta, transcript) => {
        browser.runtime.sendMessage({ type: 'MEETING_ENDED', meta, transcript }).catch(() => {});
      },
    });
    captions.restore();

    browser.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (res?: unknown) => void) => {
      const msg = message as { type?: string } | undefined;
      switch (msg?.type) {
        case 'MEET_CONNECTION_CHECK':
          sendResponse({ connected: true, message: 'Connected to Google Meet' });
          return true;
        case 'START_CAPTURE':
          captions.start();
          sendResponse({ success: true });
          return true;
        case 'STOP_CAPTURE':
          captions.stop();
          sendResponse({ success: true });
          return true;
        default:
          return false;
      }
    });
  },
});
