// Google Meet DOM selectors, kept in one place because Meet's markup changes often.

export const MEET_SELECTORS = {
  // Tile containers across grid, filmstrip, and presentations
  tiles: 'div[data-participant-id], div[data-initial-participant-id], div[data-allocation-id]',

  // Tile hover / action buttons with participant name in aria-label
  moreOptionsBtn: 'button[aria-label*="More options for" i]',
  pinBtn: 'button[aria-label*="Pin" i]',
  muteBtn: 'button[aria-label*="Mute" i]',
  avatarImg: 'img[alt]',

  // Participant video labels
  videoLabelElements: '[aria-label*="’s video" i], [aria-label*="\'s video" i], [aria-label*="’s screen" i], [aria-label*="\'s screen" i]',

  // People drawer list items (if panel is opened or rendered)
  peopleListItems: '[role="listitem"] div.zWGUkf, [role="listitem"] [data-self-name], [role="listitem"] span.notranslate:not(.google-material-icons):not(.material-icons):not([aria-hidden="true"])',

  // Toasts and snackbars ("X joined")
  toastAlerts: 'div[role="status"], div[role="alert"], div[aria-live="polite"], div[aria-live="assertive"], div.M4FdEc, div.NSO8L',

  // Closed Captions — the transcript source. Meet's class names are obfuscated and change, so every
  // selector has fallbacks, and caption-capture also falls back to a structural scan of the region.
  captionContainer: '[role="region"][aria-label*="caption" i], [aria-label*="Closed captions" i], [jsname="dsZIyd"], .nMcdL.bj4p3b',
  captionSpeakers: '.NWpY1d, .zs7s8d, [jsname="tgaKEf"] span:first-child',
  // One block per continuous stretch of speech by one speaker
  captionBlocks: '.nMcdL, .TBMuR, [jsname="tgaKEf"]',
  // The caption words inside a block
  captionText: '.ygicle, .bh44bd, .iTTPOb, [jsname="YSxPC"]',
  // Captions toggle in the bottom call-controls bar
  captionsOnButton: 'button[aria-label*="Turn on captions" i], button[aria-label*="captions" i][aria-pressed="false"]',
  // Present only once the user has actually joined the call (the Leave call button)
  inCallIndicator: 'button[aria-label*="Leave call" i], [jsname="CQylAd"]',
  // Meeting name shown in the call (falls back to document.title / meet code)
  meetingTitle: '[data-meeting-title], [jscontroller="yEvoid"] div[jsname="r4nke"]',

  // Self identification
  googleAccountBtn: 'a[aria-label*="Google Account" i], button[aria-label*="Google Account" i]',
};

// Pull the participant name out of a "X joined" toast
export const JOIN_NOTIFICATION_PATTERNS = [
  /^(.+?)\s+(?:joined|has joined)(?:\s+the\s+(?:meeting|call|video call))?/i,
  /^(.+?)\s+(?:se ha unido|a rejoint|ist beigetreten)/i,
];

// Meet UI strings that must never be taken as a person's name
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
  'apply visual effects',
  'settings',
  'in-call messages',
  'info',
  'host controls',
  'more options for',
  // icon ligatures
  'devices',
  'mic',
  'videocam',
  'security',
  'warning',
  'error',
  'check',
  'close',
  'fullscreen',
  'group',
  'groups',
  'person',
];

