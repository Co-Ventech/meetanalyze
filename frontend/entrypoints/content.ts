export default defineContentScript({
  matches: ['*://meet.google.com/*'],
  main() {
    console.log('[MeetAnalyze] Content script loaded on Google Meet.');

    browser.runtime.onMessage.addListener(
      (message: unknown, _sender: unknown, sendResponse: (res?: unknown) => void) => {
        const msg = message as { type?: string } | undefined;
        if (msg && msg.type === 'MEET_CONNECTION_CHECK') {
          sendResponse({
            connected: true,
            message: 'Connected to Google Meet',
          });
        }
        return true;
      }
    );
  },
});
