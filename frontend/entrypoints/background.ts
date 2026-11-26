import { AuthError, getSession, meetingDashboardUrl, submitMeeting } from './common/api';
import type { CaptureMeta, MeetingSubmission, TranscriptTurn } from './common/types';

/**
 * Sends a meeting for analysis as soon as it ends: when the user leaves the call (reported by the
 * content script) or closes the Meet tab while capturing.
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: any) => {
    if (message?.type === 'MEETING_ENDED') submitEndedMeeting(message.meta, message.transcript);
  });

  browser.tabs.onRemoved.addListener(async () => {
    const stored = await browser.storage.local.get(['isRecording', 'captureMeta', 'finalTranscripts']);
    if (!stored.isRecording || !stored.captureMeta) return;
    const meetTabs = await browser.tabs.query({ url: '*://meet.google.com/*' });
    const meetCode = (stored.captureMeta as CaptureMeta).meetCode;
    if (meetTabs.some((t) => t.url?.includes(meetCode))) return;

    const meta = { ...(stored.captureMeta as CaptureMeta), endedAt: Date.now() };
    await browser.storage.local.set({ isRecording: false, captionsOn: false, partialTranscript: null, captureMeta: meta });
    await submitEndedMeeting(meta, (stored.finalTranscripts as TranscriptTurn[]) ?? []);
  });
});

const setSubmission = (submission: MeetingSubmission) => browser.storage.local.set({ lastSubmission: submission });

async function submitEndedMeeting(meta: CaptureMeta, transcript: TranscriptTurn[]) {
  if (!meta || !transcript?.some((t) => !t.systemNotice && t.text?.trim())) return;

  const { lastSubmission } = (await browser.storage.local.get('lastSubmission')) as { lastSubmission?: MeetingSubmission };
  if (lastSubmission?.startedAt === meta.startedAt && lastSubmission.status !== 'signed_out') return;

  const { startedAt } = meta;
  const session = await getSession();
  if (!session) {
    await setSubmission({ startedAt, status: 'signed_out', message: 'Sign in to analyse this meeting.' });
    return;
  }

  await setSubmission({ startedAt, status: 'processing' });
  // The analysis can take a minute; calling an extension API keeps the service worker alive meanwhile.
  const keepAlive = setInterval(() => browser.runtime.getPlatformInfo(), 20_000);
  try {
    const result = await submitMeeting(session, meta, transcript);
    const url = meetingDashboardUrl(result.id);
    await setSubmission({
      startedAt,
      status: result.analysisFailed ? 'failed' : 'ready',
      meetingId: result.id,
      url,
      message: result.analysisFailed ? result.message || 'Saved, but the analysis failed. Retry it from the dashboard.' : undefined,
    });
    if (!result.analysisFailed) browser.tabs.create({ url });
  } catch (err: any) {
    await setSubmission({
      startedAt,
      status: err instanceof AuthError ? 'signed_out' : 'failed',
      message: err?.message || 'Failed to analyse the meeting.',
    });
  } finally {
    clearInterval(keepAlive);
  }
}
