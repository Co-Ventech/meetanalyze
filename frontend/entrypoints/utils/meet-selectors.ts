/**
 * Google Meet DOM Selectors & Resilient Matching Rules
 * Isolated in a single file for easy maintenance when Google updates Meet's markup.
 */

export const MEET_SELECTORS = {
  // Tile containers across grid, filmstrip, and presentations
  tiles: 'div[data-participant-id], div[data-initial-participant-id], div[data-allocation-id]',
  selfTile: 'div[data-requested-participant-id], div[data-participant-id]:has([aria-label*="(You)" i])',

  // Participant name containers
  nameElements: '.notranslate, [data-self-name], div.zWGUkf, [role="heading"][aria-level="3"]',

  // Tile hover / action buttons with participant name in aria-label
  moreOptionsBtn: 'button[aria-label*="More options for" i]',
  pinBtn: 'button[aria-label*="Pin" i]',
  muteBtn: 'button[aria-label*="Mute" i]',
  avatarImg: 'img[alt]',

  // Participant video labels
  videoLabelElements: '[aria-label*="’s video" i], [aria-label*="\'s video" i], [aria-label*="’s screen" i], [aria-label*="\'s screen" i]',

  // People drawer list items (if panel is opened or rendered)
  peopleListItems: '[role="listitem"] [data-self-name], [role="listitem"] .notranslate, div[data-participant-id] .notranslate',

  // People counter button (e.g. "People (3)" or "Show everyone (3)")
  participantCountBtn: 'button[aria-label*="people" i], button[aria-label*="Show everyone" i], button[data-panel-id="1"]',

  // Join/Leave toast notifications and snackbars
  toastAlerts: 'div[role="status"], div[role="alert"], div[aria-live="polite"], div[aria-live="assertive"], div.M4FdEc, div.NSO8L',

  // Closed Captions (real-time backup)
  captionContainer: '[role="region"][aria-label*="caption" i], [aria-label*="Closed captions" i], [jsname="dsZIyd"], .nMcdL.bj4p3b',
  captionSpeakers: '.NWpY1d, .zs7s8d, [jsname="tgaKEf"] span:first-child',

  // Self identification
  googleAccountBtn: 'a[aria-label*="Google Account" i], button[aria-label*="Google Account" i]',

  // Fallbacks
  fallbackClientLabel: 'Client',
  fallbackAgentLabel: 'You',
};

// Regex patterns to extract participant names from join/leave notification toasts
export const JOIN_NOTIFICATION_PATTERNS = [
  /^(.+?)\s+(?:joined|has joined)(?:\s+the\s+(?:meeting|call|video call))?/i,
  /^(.+?)\s+joined$/i,
  /^(.+?)\s+(?:se ha unido|a rejoint|ist beigetreten)/i,
];

export const LEAVE_NOTIFICATION_PATTERNS = [
  /^(.+?)\s+(?:left|has left)(?:\s+the\s+(?:meeting|call|video call))?/i,
  /^(.+?)\s+left$/i,
  /^(.+?)\s+(?:ha salido|a quitté|hat die Besprechung verlassen)/i,
];

// Colors indicating active speaking border in Google Meet (Google blue tones)
export const ACTIVE_SPEAKER_BORDER_COLORS = [
  'rgb(138, 180, 248)',
  'rgb(102, 157, 246)',
  'rgb(66, 133, 244)',
  '#8ab4f8',
  '#669df6',
  '#4285f4',
];

// UI strings that must never be mistaken for human names
export const UI_BLACKLIST = [
  'turn on captions',
  'turn off captions',
  'turn on microphone',
  'turn off microphone',
  'turn on camera',
  'turn off camera',
  'leave call',
  'meeting details',
  'people',
  'chat',
  'activities',
  'more options',
  'pin to screen',
  'pin',
  'unpin',
  'presentation',
  'present now',
  'raise hand',
  'lower hand',
  'meeting info',
  'closed captions',
  'send a message',
  'show for everyone',
  'visual effects',
  'settings',
  'apply visual effects',
  'in-call messages',
  'info',
  'host controls',
  'more options for',
];

