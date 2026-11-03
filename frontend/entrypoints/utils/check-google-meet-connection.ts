import { MEETING_LINKS } from '../common/constants';

function isGoogleMeetUrl(url?: string): boolean {
  if (!url) return false;
  return url.startsWith(MEETING_LINKS.GOOGLE_MEET.URL) || url.includes('meet.google.com');
}

export async function getGoogleMeetTab() {
  try {
    // 1. Check active tab in current window first
    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (activeTab?.id && isGoogleMeetUrl(activeTab.url)) {
      return activeTab;
    }
  } catch (err) {
    console.warn('[MeetAnalyze] Failed to query active tab:', err);
  }

  try {
    // 2. Query any Google Meet tab across any window by URL pattern
    const allMeetTabs = await browser.tabs.query({
      url: '*://meet.google.com/*',
    });

    if (allMeetTabs.length > 0 && allMeetTabs[0]?.id) {
      return allMeetTabs[0];
    }
  } catch (err) {
    console.warn('[MeetAnalyze] Failed to query meet tabs by url match:', err);
  }

  try {
    // 3. Fallback: query all tabs and filter by URL
    const allTabs = await browser.tabs.query({});
    const meetTab = allTabs.find((t) => t?.id && isGoogleMeetUrl(t.url));
    if (meetTab) {
      return meetTab;
    }
  } catch (err) {
    console.warn('[MeetAnalyze] Failed to query all tabs fallback:', err);
  }

  return null;
}

export async function checkLinkConnection() {
  const tab = await getGoogleMeetTab();

  if (!tab || !tab.id || !isGoogleMeetUrl(tab.url)) {
    return {
      connected: false,
      message: 'Google Meet not detected',
      tabId: null,
    };
  }

  try {
    const response = await browser.tabs.sendMessage(tab.id, {
      type: 'MEET_CONNECTION_CHECK',
    });

    return {
      connected: !!response?.connected,
      message: response?.message || 'Connected to Google Meet',
      tabId: tab.id,
    };
  } catch {
    // Content script might not have injected yet if page just opened
    return {
      connected: true,
      message: 'Google Meet Active (Tab found)',
      tabId: tab.id,
    };
  }
}
