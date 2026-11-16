declare const chrome: any;

/**
 * Background service worker.
 * Caption capture runs entirely in the Meet tab's content script, which writes its state to
 * chrome.storage.local. The background only handles UI helpers.
 */
export default defineBackground(() => {
  console.log('[MeetAnalyze] Background service worker initialized.');

  chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
    if (message?.type === 'OPEN_SIDE_PANEL') {
      const windowId = sender.tab?.windowId;
      if (chrome.sidePanel?.open) {
        chrome.sidePanel.open({ windowId }, () => {
          sendResponse({ success: !chrome.runtime.lastError });
        });
        return true;
      }
      sendResponse({ success: false, message: 'Side panel API not supported' });
      return true;
    }

    return false;
  });
});
