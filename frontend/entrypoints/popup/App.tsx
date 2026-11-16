import { useState, useEffect, type FormEvent } from 'react';
import './App.css';
import { checkLinkConnection } from '../utils/check-google-meet-connection';
import { useRealtimeTranscription } from './hooks/useRealtimeTranscription';
import {
  AuthError,
  DASHBOARD_URL,
  clearSession,
  getSession,
  login,
  meetingDashboardUrl,
  submitMeeting,
  type AuthSession,
} from '../common/api';

function LoginForm({ onLoggedIn }: { onLoggedIn: (s: AuthSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await login(email.trim(), password));
    } catch (err: any) {
      setError(err?.message || 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-slate-950/70 border border-slate-800 rounded-md p-3 flex flex-col gap-2">
      <p className="text-xs text-slate-300 font-medium">Sign in to save meetings to your dashboard</p>
      <input
        type="email"
        required
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
      />
      <input
        type="password"
        required
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
      />
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <a
          href={`${DASHBOARD_URL}/register`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-slate-400 hover:text-blue-400 underline"
        >
          Create an account
        </a>
        <button
          type="submit"
          disabled={busy}
          className="py-1.5 px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium rounded cursor-pointer"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </form>
  );
}

function App() {
  const [meetStatus, setMeetStatus] = useState('Checking Google Meet...');
  const [isMeetConnected, setIsMeetConnected] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [insightMessage, setInsightMessage] = useState<{ type: 'success' | 'error'; text: string; url?: string } | null>(null);

  const {
    isRecording,
    isConnecting,
    captionsOn,
    partialTranscript,
    finalTranscripts,
    captureMeta,
    captureNotice,
    error,
    startRecording,
    stopRecording,
    clearTranscripts,
  } = useRealtimeTranscription();

  const checkMeet = async () => {
    try {
      const result = await checkLinkConnection();
      setIsMeetConnected(result.connected);
      setMeetStatus(result.connected ? 'Google Meet Active' : result.message || 'Not on Google Meet');
    } catch {
      setIsMeetConnected(false);
      setMeetStatus('Google Meet disconnected');
    }
  };

  useEffect(() => {
    checkMeet();
    getSession().then((s) => {
      setSession(s);
      setSessionLoaded(true);
    });
  }, []);

  const openSidePanel = async () => {
    try {
      const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (currentTab?.windowId && (browser as any).sidePanel?.open) {
        await (browser as any).sidePanel.open({ windowId: currentTab.windowId });
        window.close();
      }
    } catch (err) {
      console.warn('[MeetAnalyze] Side panel open failed:', err);
    }
  };

  const openUrl = (url: string) => browser.tabs.create({ url });

  const signOut = async () => {
    await clearSession();
    setSession(null);
  };

  const handleAnalyze = async () => {
    if (!session) return;
    setInsightMessage(null);

    const turns = [...finalTranscripts];
    if (partialTranscript?.text?.trim()) {
      const now = Date.now();
      turns.push({
        id: `partial_${now}`,
        speaker: partialTranscript.speaker,
        isSelf: partialTranscript.isSelf,
        text: partialTranscript.text,
        timestamp: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        startMs: now,
        endMs: now,
      });
    }
    if (turns.length === 0) return;

    setIsSubmitting(true);
    try {
      if (isRecording) await stopRecording();
      const result = await submitMeeting(session, captureMeta, turns);
      const url = meetingDashboardUrl(result.id);
      if (result.analysisFailed) {
        setInsightMessage({
          type: 'error',
          text: result.message || 'Saved, but the analysis failed. Retry it from the dashboard.',
          url,
        });
      } else {
        setInsightMessage({ type: 'success', text: 'Meeting analysed. Opening your dashboard…', url });
        openUrl(url);
      }
    } catch (err: any) {
      if (err instanceof AuthError) setSession(null);
      setInsightMessage({ type: 'error', text: err?.message || 'Failed to analyse the meeting.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasTranscript = finalTranscripts.length > 0 || !!partialTranscript?.text;
  const participants = captureMeta?.participants ?? [];

  return (
    <div className="w-full max-w-[420px] min-w-[340px] p-4 bg-slate-900 text-white font-sans rounded-lg shadow-xl flex flex-col gap-3 min-h-[490px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            MeetAnalyze
          </h1>
          <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
            <span className={`w-2 h-2 rounded-full ${isMeetConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {meetStatus}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => openUrl(`${DASHBOARD_URL}/meetings`)}
            className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition cursor-pointer"
            title="Open your meetings dashboard"
          >
            Dashboard
          </button>
          <button
            onClick={openSidePanel}
            className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition cursor-pointer"
            title="Dock to Chrome Side Panel (keeps view open during meeting)"
          >
            📌
          </button>
          <button
            onClick={checkMeet}
            className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition cursor-pointer"
            title="Re-check Google Meet tab"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Account */}
      {sessionLoaded && !session && <LoginForm onLoggedIn={setSession} />}
      {session && (
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="truncate">
            Signed in as <span className="text-slate-200">{session.user?.name || session.user?.email}</span>
          </span>
          <button onClick={signOut} className="text-slate-500 hover:text-rose-300 underline cursor-pointer shrink-0">
            Sign out
          </button>
        </div>
      )}

      {/* Capture status */}
      <div className="flex items-center gap-2 text-[11px]">
        <div
          className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded border ${
            isRecording && captionsOn
              ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
              : isRecording
              ? 'bg-amber-950/60 border-amber-700/60 text-amber-300 animate-pulse'
              : 'bg-slate-950 border-slate-800 text-slate-500'
          }`}
        >
          <span>💬</span>
          <span>Meet captions: {isRecording ? (captionsOn ? 'Capturing' : 'Waiting…') : 'Off'}</span>
        </div>
        <div
          className="flex items-center justify-center gap-1 py-1 px-2 rounded border bg-slate-950 border-slate-800 text-slate-400 text-[10px]"
          title="Meeting analysis supports English transcripts"
        >
          <span>🌐</span>
          <span>EN</span>
        </div>
      </div>

      {isRecording && captureNotice && (
        <div className="p-2 bg-amber-950/70 border border-amber-700/60 rounded text-[11px] text-amber-200 flex items-start gap-1.5">
          <span>⚠️</span>
          <span>{captureNotice}</span>
        </div>
      )}

      {/* Participants */}
      <div className="bg-slate-950/70 border border-slate-800/80 rounded-md p-2 text-[11px] flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 font-medium text-[10px] uppercase tracking-wider">
            Participants ({participants.length})
          </span>
          <span className="text-[10px] text-slate-500 truncate max-w-[55%]">{captureMeta?.title || ''}</span>
        </div>
        <div className="flex items-center flex-wrap gap-1.5">
          {participants.length > 0 ? (
            participants.map((name) => {
              const isSelf = name === captureMeta?.selfName;
              const speaking = partialTranscript?.speaker === name;
              return (
                <span
                  key={name}
                  className={`px-2 py-0.5 rounded border text-[11px] flex items-center gap-1 ${
                    isSelf
                      ? 'bg-blue-950/80 border-blue-800/80 text-blue-300'
                      : speaking
                      ? 'bg-emerald-900/80 border-emerald-500 text-emerald-200'
                      : 'bg-emerald-950/70 border-emerald-800/70 text-emerald-300'
                  }`}
                >
                  {speaking && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
                  {name}
                  {isSelf && ' (You)'}
                </span>
              );
            })
          ) : (
            <span className="text-slate-500 italic px-1">
              {isRecording ? 'Detecting participants…' : 'Start capture to detect participants'}
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={isConnecting || !isMeetConnected}
            className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-60 text-white font-medium text-sm rounded-md transition flex items-center justify-center gap-2 shadow cursor-pointer"
          >
            {isConnecting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 bg-red-400 rounded-full" />
                Start Capturing Transcript
              </>
            )}
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex-1 py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white font-medium text-sm rounded-md transition flex items-center justify-center gap-2 shadow cursor-pointer"
          >
            <span className="w-2.5 h-2.5 bg-white rounded-sm" />
            Stop Capturing
          </button>
        )}

        <button
          onClick={clearTranscripts}
          disabled={isRecording || !hasTranscript}
          className="py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-sm rounded-md transition cursor-pointer"
          title="Clear transcript"
        >
          Clear
        </button>
      </div>

      {/* Analyse & open dashboard */}
      <button
        onClick={handleAnalyze}
        disabled={!session || isSubmitting || !hasTranscript}
        className="w-full py-2 px-3 bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-xs rounded-md transition-all flex items-center justify-center gap-1.5 shadow cursor-pointer"
        title={session ? 'Analyse the meeting and open the results dashboard' : 'Sign in first'}
      >
        {isSubmitting ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span>Analysing meeting…</span>
          </>
        ) : (
          <>
            <span>📊</span>
            <span>Show Meeting Insight</span>
          </>
        )}
      </button>

      {insightMessage && (
        <div
          className={`p-2 rounded text-xs flex items-center justify-between gap-1.5 ${
            insightMessage.type === 'success'
              ? 'bg-emerald-950/80 border border-emerald-700/80 text-emerald-200'
              : 'bg-rose-950/80 border border-rose-800/80 text-rose-200'
          }`}
        >
          <span>
            {insightMessage.type === 'success' ? '✅' : '⚠️'} {insightMessage.text}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {insightMessage.url && (
              <button onClick={() => openUrl(insightMessage.url!)} className="underline text-[11px] cursor-pointer">
                Open
              </button>
            )}
            <button onClick={() => setInsightMessage(null)} className="text-[10px] text-slate-400 hover:text-white px-1 cursor-pointer">
              ✕
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-2.5 bg-rose-950/80 border border-rose-800/80 rounded text-xs text-rose-200">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Live transcript */}
      <div className="flex-1 bg-slate-950/90 border border-slate-800 rounded-md p-3 overflow-y-auto max-h-[260px] flex flex-col gap-2.5 select-text text-xs leading-relaxed">
        {!hasTranscript && (
          <div className="m-auto text-center text-slate-500 text-xs py-8">
            Join your Google Meet call and click <strong>Start Capturing Transcript</strong>. MeetAnalyze turns on Meet's
            captions and records who said what.
          </div>
        )}

        {finalTranscripts.map((turn) => (
          <div
            key={turn.id}
            className={`p-2.5 rounded-lg border flex flex-col gap-1 max-w-[90%] ${
              turn.isSelf ? 'bg-blue-950/30 border-blue-800/60 self-end' : 'bg-emerald-950/30 border-emerald-800/60 self-start'
            }`}
          >
            <div className="flex items-center justify-between gap-3 text-[11px] font-semibold border-b border-white/5 pb-1">
              <span className={turn.isSelf ? 'text-blue-300' : 'text-emerald-300'}>{turn.speaker}</span>
              {turn.timestamp && <span className="text-[10px] text-slate-500 font-normal">{turn.timestamp}</span>}
            </div>
            <p className="text-slate-200 text-xs pt-0.5 leading-relaxed">{turn.text}</p>
          </div>
        ))}

        {partialTranscript?.text && (
          <div
            className={`p-2.5 rounded-lg border flex flex-col gap-1 max-w-[90%] ${
              partialTranscript.isSelf ? 'bg-blue-950/20 border-blue-700/50 self-end' : 'bg-emerald-950/20 border-emerald-700/50 self-start'
            }`}
          >
            <div className="flex items-center gap-1 text-[11px] font-semibold">
              <span className={partialTranscript.isSelf ? 'text-blue-400' : 'text-emerald-400'}>{partialTranscript.speaker}</span>
              <span className="text-[10px] text-slate-400 font-normal italic">(speaking…)</span>
            </div>
            <p className="text-slate-300 text-xs italic">{partialTranscript.text}</p>
          </div>
        )}
      </div>

      <div className="text-[10px] text-slate-500 text-center">Transcript source: Google Meet live captions</div>
    </div>
  );
}

export default App;
