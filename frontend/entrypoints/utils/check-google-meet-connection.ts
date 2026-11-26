const isGoogleMeetUrl = (url?: string) => !!url?.includes('meet.google.com');

/** The active tab if it's a Meet call, otherwise any open Meet tab. */
export async function getGoogleMeetTab() {
  try {
    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    if (active?.id && isGoogleMeetUrl(active.url)) return active;

    const meetTabs = await browser.tabs.query({ url: '*://meet.google.com/*' });
    return meetTabs.find((t) => t.id) ?? null;
  } catch (err) {
    console.warn('Could not query tabs:', err);
    return null;
  }
}

export async function checkLinkConnection() {
  const tab = await getGoogleMeetTab();
  if (!tab?.id) return { connected: false, message: 'Google Meet not detected', tabId: null };

  try {
    const response = await browser.tabs.sendMessage(tab.id, { type: 'MEET_CONNECTION_CHECK' });
    return { connected: !!response?.connected, message: response?.message || 'Connected to Google Meet', tabId: tab.id };
  } catch {
    // The content script may not have loaded yet in a freshly opened tab.
    return { connected: true, message: 'Google Meet tab found', tabId: tab.id };
  }
}
