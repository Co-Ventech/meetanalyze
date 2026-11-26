import { UI_BLACKLIST } from './meet-selectors';

// Meet labels devices and streams as "<name>'s microphone", "<name>'s video", etc.
const POSSESSIVE_SUFFIX =
  /['’]s\s+(?:microphone|mic|camera|video|audio|screen|presentation|feed|tile|stream)(?:\s+(?:is\s+)?(?:muted|unmuted|on|off|turned\s+(?:on|off)))?$/i;

// A word from this list never appears in a real display name, so any text containing one is UI.
const UI_WORDS = new Set([
  'microphone', 'mic', 'camera', 'webcam', 'video', 'audio', 'speaker', 'speakers', 'sound', 'volume',
  'mute', 'muted', 'unmute', 'unmuted', 'screen', 'presenting', 'presentation', 'caption', 'captions',
  'meeting', 'call', 'joined', 'left', 'settings', 'options', 'effects', 'background', 'chat',
  'participant', 'participants', 'people', 'host', 'reactions', 'recording', 'transcript',
  'notification', 'notifications', 'device', 'devices', 'layout', 'pin', 'pinned', 'unpin',
  'fullscreen', 'connection', 'network', 'raised', 'hand', 'everyone', 'turn', 'click',
  // sentence words from notices like "You have joined" or "Your camera is off"
  'you', 'your', 'has', 'have', 'had', 'is', 'are', 'was', 'were', 'been', 'the', 'this', 'now',
]);

export const cleanName = (name: string): string =>
  (name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(POSSESSIVE_SUFFIX, '')
    .replace(/\s*\((?:You|Presentation|Screen)\)\s*$/i, '')
    .replace(/^\s*\(You\)\s*/i, '')
    .trim();

/** True for Meet UI strings and icon ligatures that must never be taken as a person's name. */
export const isInvalidName = (str: string): boolean => {
  if (!str || str.length < 2 || str.length > 50) return true;
  const lower = str.toLowerCase().trim();
  if (lower.includes('_')) return true; // icon ligatures are snake_case (more_vert, frame_person)
  if (/^\d+$/.test(lower) || /^\d{1,2}:\d{2}(\s*(?:am|pm))?$/.test(lower)) return true;
  if (/[:?!;"“”()[\]{}|/\\@#<>=+*]/.test(lower)) return true; // sentences and labels, not names
  const words = lower.split(/\s+/);
  if (words.length > 5) return true;
  if (words.some((w) => UI_WORDS.has(w.replace(/['’]s$/, '')))) return true;
  return UI_BLACKLIST.some((b) => lower === b || lower.startsWith(`${b}:`));
};

/** Cleaned name, or null if it isn't a usable participant name. */
export const toName = (raw: string | null | undefined): string | null => {
  const name = cleanName(raw || '');
  return name && !isInvalidName(name) && name.toLowerCase() !== 'you' ? name : null;
};
