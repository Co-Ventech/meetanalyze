declare const chrome: any;

let creatingOffscreen: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
  if (typeof chrome.offscreen?.hasDocument === 'function') {
    return await chrome.offscreen.hasDocument();
  }
  if (typeof chrome.runtime?.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Record and transcribe Google Meet meeting audio in the background',
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

export default defineBackground(() => {
  console.log('[MeetAnalyze] Background service worker initialized.');

  chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
    // 1. Open Side Panel if requested
    if (message.type === 'OPEN_SIDE_PANEL') {
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

    // 2. Start Recording (setup offscreen and forward)
    if (message.type === 'START_RECORDING') {
      (async () => {
        try {
          await ensureOffscreenDocument();

          // Get previously saved transcripts to preserve them
          const stored = await chrome.storage?.local?.get(['finalTranscripts']);
          const initialTranscripts = Array.isArray(stored?.finalTranscripts) ? stored.finalTranscripts : [];

          await chrome.storage?.local?.set({
            isRecording: true,
            isTabAudioCaptured: false,
            partialTranscript: '',
            finalTranscripts: initialTranscripts,
          });

          // Forward start message to offscreen document
          chrome.runtime.sendMessage(
            {
              type: 'START_OFFSCREEN_RECORDING',
              streamId: message.streamId,
              token: message.token,
              initialTranscripts,
            },
            (response: any) => {
              sendResponse(response || { success: true });
            }
          );
        } catch (err: any) {
          console.error('[MeetAnalyze] Failed to start offscreen recording:', err);
          sendResponse({ success: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // 3. Stop Recording
    if (message.type === 'STOP_RECORDING') {
      chrome.runtime.sendMessage(
        {
          type: 'STOP_OFFSCREEN_RECORDING',
        },
        async (response: any) => {
          await chrome.storage?.local?.set({
            isRecording: false,
            isTabAudioCaptured: false,
            partialTranscript: '',
          });
          sendResponse(response || { success: true });
        }
      );
      return true;
    }

    // 4. Persistence handlers for events coming from offscreen
    if (message.type === 'TRANSCRIPT_UPDATE') {
      chrome.storage?.local?.set({
        isRecording: true,
        partialTranscript: message.partialTranscript || '',
        finalTranscripts: message.finalTranscripts || [],
        isTabAudioCaptured: !!message.isTabAudioCaptured,
      });
      return false;
    }

    if (message.type === 'RECORDING_STARTED') {
      chrome.storage?.local?.set({
        isRecording: true,
        isTabAudioCaptured: !!message.isTabAudioCaptured,
      });
      return false;
    }

    if (message.type === 'RECORDING_STOPPED') {
      chrome.storage?.local?.set({
        isRecording: false,
        isTabAudioCaptured: false,
        partialTranscript: '',
        finalTranscripts: message.finalTranscripts || [],
      });
      return false;
    }

    if (message.type === 'CLEAR_TRANSCRIPTS') {
      chrome.storage?.local?.set({
        partialTranscript: '',
        finalTranscripts: [],
      });
      return false;
    }

    return false;
  });
});
