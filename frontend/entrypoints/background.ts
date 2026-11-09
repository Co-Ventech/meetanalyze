import type { MeetRelabelJob, TranscriptTurn } from './common/types';
import {
  extractMeetingCode,
  fetchMeetTranscriptEntries,
  getToken,
  isMeetApiConfigured,
  MeetApiUnavailableError,
  relabelTurns,
} from './utils/meet-rest';

declare const chrome: any;

const RELABEL_ALARM = 'meet-relabel';
const RELABEL_MAX_ATTEMPTS = 15; // ~15 minutes of polling after the meeting

interface RecordingSession {
  tabId: number | null;
  meetingCode: string | null;
  startedAt: number;
}

function notifyMeetTab(tabId: number | null | undefined, type: string) {
  if (!tabId || !chrome.tabs?.sendMessage) return;
  chrome.tabs.sendMessage(tabId, { type }, () => {
    // Ignore "no receiving end" if the tab was closed
    void chrome.runtime.lastError;
  });
}

let endingSession: Promise<void> | null = null;

// STOP_RECORDING's callback and RECORDING_STOPPED can both fire; run the end-of-session work once
function onRecordingEnded(): Promise<void> {
  if (!endingSession) {
    endingSession = finishRecordingSession().finally(() => {
      endingSession = null;
    });
  }
  return endingSession;
}

async function finishRecordingSession() {
  const stored = await chrome.storage?.local?.get(['recordingSession']);
  const session: RecordingSession | undefined = stored?.recordingSession;
  if (!session) return;
  await chrome.storage.local.remove('recordingSession');

  notifyMeetTab(session.tabId, 'MEETANALYZE_RECORDING_STOPPED');

  if (session.meetingCode) {
    const job: MeetRelabelJob = {
      meetingCode: session.meetingCode,
      startedAt: session.startedAt,
      stoppedAt: Date.now(),
      attempts: 0,
    };
    // lastMeetSession survives giving up, so the manual "Fix names" button still works later
    await chrome.storage.local.set({ meetRelabelJob: job, lastMeetSession: job });
    if (isMeetApiConfigured() && chrome.alarms) {
      chrome.alarms.create(RELABEL_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
    }
  }
}

type RelabelOutcome =
  | { status: 'done'; changed: number }
  | { status: 'pending' }
  | { status: 'unavailable'; reason: string };

async function clearRelabelJob() {
  await chrome.storage.local.remove('meetRelabelJob');
  chrome.alarms?.clear(RELABEL_ALARM);
}

async function runMeetRelabel(job: MeetRelabelJob, interactive: boolean): Promise<RelabelOutcome> {
  const token = await getToken(interactive);
  const result = await fetchMeetTranscriptEntries(token, job.meetingCode, job.startedAt, job.stoppedAt);
  if (result.status !== 'ready') return result;

  const stored = await chrome.storage.local.get(['finalTranscripts']);
  const turns: TranscriptTurn[] = Array.isArray(stored?.finalTranscripts) ? stored.finalTranscripts : [];
  const { turns: relabeled, changed } = relabelTurns(turns, result.entries);

  await chrome.storage.local.set({ finalTranscripts: relabeled });
  chrome.runtime.sendMessage({ type: 'TRANSCRIPTS_RELABELED', finalTranscripts: relabeled, changed }).catch(() => {});
  console.log(`[MeetAnalyze] Meet REST relabel complete: ${changed} turn(s) updated.`);
  return { status: 'done', changed };
}

async function handleRelabelAlarm() {
  const stored = await chrome.storage.local.get(['meetRelabelJob']);
  const job: MeetRelabelJob | undefined = stored?.meetRelabelJob;
  if (!job) {
    chrome.alarms?.clear(RELABEL_ALARM);
    return;
  }

  try {
    const outcome = await runMeetRelabel(job, false);
    if (outcome.status === 'pending') {
      job.attempts++;
      if (job.attempts >= RELABEL_MAX_ATTEMPTS) {
        await clearRelabelJob();
      } else {
        await chrome.storage.local.set({ meetRelabelJob: job });
      }
      return;
    }
    // done or unavailable -> stop polling quietly
    await clearRelabelJob();
  } catch (err) {
    job.attempts++;
    if (err instanceof MeetApiUnavailableError || job.attempts >= RELABEL_MAX_ATTEMPTS) {
      // Not signed in / no access / no transcript: skip quietly, live transcript stays as-is
      await clearRelabelJob();
    } else {
      await chrome.storage.local.set({ meetRelabelJob: job });
    }
  }
}

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

  chrome.alarms?.onAlarm.addListener((alarm: any) => {
    if (alarm?.name === RELABEL_ALARM) {
      handleRelabelAlarm().catch((err) => console.warn('[MeetAnalyze] Relabel alarm failed:', err));
    }
  });

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
          const stored = await chrome.storage?.local?.get(['finalTranscripts', 'speakerInfo']);
          const initialTranscripts = Array.isArray(stored?.finalTranscripts) ? stored.finalTranscripts : [];

          // Remember the meeting so the post-meeting relabel can find its conference record
          let meetingCode: string | null = null;
          if (message.targetTabId && chrome.tabs?.get) {
            try {
              const tab = await chrome.tabs.get(message.targetTabId);
              meetingCode = extractMeetingCode(tab?.url);
            } catch {}
          }
          const session: RecordingSession = {
            tabId: message.targetTabId ?? null,
            meetingCode,
            startedAt: Date.now(),
          };

          await chrome.storage?.local?.set({
            isRecording: true,
            isTabAudioCaptured: false,
            partialTranscript: '',
            finalTranscripts: initialTranscripts,
            recordingSession: session,
          });

          // Turn on (hidden) Meet captions so the content script can read speaker names
          notifyMeetTab(session.tabId, 'MEETANALYZE_RECORDING_STARTED');

          // Forward start message to offscreen document
          chrome.runtime.sendMessage(
            {
              type: 'START_OFFSCREEN_RECORDING',
              streamId: message.streamId,
              micToken: message.micToken || message.token,
              tabToken: message.tabToken,
              host: message.host,
              initialTranscripts,
              targetTabId: message.targetTabId,
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
          await onRecordingEnded();
          sendResponse(response || { success: true });
        }
      );
      return true;
    }

    // 4. Tab speaker bridge: Offscreen document requests speaker info via Background
    if (message.type === 'POLL_SPEAKER_INFO') {
      const tabId = message.targetTabId;
      if (tabId && chrome.tabs?.sendMessage) {
        chrome.tabs.sendMessage(tabId, { type: 'GET_SPEAKER_INFO' }, (res: any) => {
          if (chrome.runtime.lastError || !res) {
            sendResponse({ success: false });
            return;
          }
          sendResponse({ success: true, speakerInfo: res });
        });
        return true;
      }
      sendResponse({ success: false });
      return true;
    }

    // 5. Speaker info update from Content Script -> Save & Forward to Offscreen and UI
    if (message.type === 'SPEAKER_INFO_UPDATED') {
      if (message.speakerInfo) {
        chrome.storage?.local?.set({ speakerInfo: message.speakerInfo });
        // Broadcast to offscreen and popup/sidepanel
        chrome.runtime.sendMessage({
          type: 'SPEAKER_INFO_DISPATCH',
          speakerInfo: message.speakerInfo,
        }).catch(() => {});
      }
      return false;
    }

    // 5b. Participant joined or left notifications -> Forward to Offscreen and UI
    if (message.type === 'PARTICIPANTS_JOINED' || message.type === 'PARTICIPANTS_LEFT') {
      chrome.runtime.sendMessage(message).catch(() => {});
      return false;
    }

    // 6. User sets manual guest name override
    if (message.type === 'SET_GUEST_NAME') {
      chrome.runtime.sendMessage({
        type: 'SET_GUEST_NAME_OFFSCREEN',
        originalName: message.originalName,
        name: message.name,
      }).catch(() => {});
      return false;
    }

    // 6b. Manual "Fix speaker names from Google Meet" request from the UI
    if (message.type === 'RELABEL_FROM_MEET') {
      (async () => {
        try {
          if (!isMeetApiConfigured()) {
            sendResponse({ status: 'unavailable', reason: 'Google sign-in is not configured for this build.' });
            return;
          }
          const stored = await chrome.storage.local.get(['meetRelabelJob', 'lastMeetSession']);
          const job: MeetRelabelJob | undefined = stored?.meetRelabelJob || stored?.lastMeetSession;
          if (!job) {
            sendResponse({ status: 'unavailable', reason: 'No recorded Google Meet session to match.' });
            return;
          }
          const outcome = await runMeetRelabel(job, true);
          if (outcome.status !== 'pending') await clearRelabelJob();
          sendResponse(outcome);
        } catch (err: any) {
          sendResponse({ status: 'unavailable', reason: err?.message || String(err) });
        }
      })();
      return true;
    }

    // 7. Persistence handlers for events coming from offscreen
    if (message.type === 'TRANSCRIPT_UPDATE') {
      chrome.storage?.local?.set({
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
      // Covers stops initiated by the offscreen document itself (e.g. socket closed)
      onRecordingEnded().catch(() => {});
      return false;
    }

    if (message.type === 'CLEAR_TRANSCRIPTS') {
      chrome.storage?.local?.set({
        partialTranscript: '',
        finalTranscripts: [],
      });
      clearRelabelJob().catch(() => {});
      chrome.storage?.local?.remove('lastMeetSession');
      return false;
    }

    return false;
  });
});
