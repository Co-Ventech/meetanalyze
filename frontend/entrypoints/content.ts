import { MEET_SELECTORS, UI_BLACKLIST, JOIN_NOTIFICATION_PATTERNS } from './utils/meet-selectors';
import { createCaptionCapture } from './utils/caption-capture';

const SELF_LABEL = 'You';
const NAME_NODE = 'div.zWGUkf, [role="heading"][aria-level="3"]';
const ICON_CLASSES = '.google-material-icons, .material-icons, [class*="material-symbols"]';

const cleanName = (name: string): string =>
  (name || '')
    .replace(/\s*\((?:You|Presentation|Screen)\)\s*$/i, '')
    .replace(/^\s*\(You\)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

/** True for Meet UI strings and icon ligatures that must never be taken as a person's name. */
const isInvalidName = (str: string): boolean => {
  if (!str || str.length < 2 || str.length > 50) return true;
  const lower = str.toLowerCase().trim();
  if (lower.includes('_')) return true; // icon ligatures are snake_case (more_vert, frame_person)
  if (/^\d+$/.test(lower) || /^\d{1,2}:\d{2}(\s*(?:am|pm))?$/.test(lower)) return true;
  return UI_BLACKLIST.some((b) => lower === b || lower.startsWith(`${b}:`));
};

/** Cleaned name, or null if it isn't a usable participant name. */
const toName = (raw: string | null | undefined): string | null => {
  const name = cleanName(raw || '');
  return name && !isInvalidName(name) && name.toLowerCase() !== 'you' ? name : null;
};

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
