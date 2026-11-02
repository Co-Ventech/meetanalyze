import { useState, useEffect } from 'react';
import './App.css';
import { checkLinkConnection } from '../utils/check-google-meet-connection';
import { useRealtimeTranscription } from './hooks/useRealtimeTranscription';

function App() {
  const [meetStatus, setMeetStatus] = useState('Checking Google Meet...');
  const [isMeetConnected, setIsMeetConnected] = useState(false);

  const {
    isRecording,
    isConnecting,
    isPermissionRequired,
    partialTranscript,
    finalTranscripts,
    error,
    startRecording,
    stopRecording,
    clearTranscripts,
  } = useRealtimeTranscription({
    apiBaseUrl: 'http://localhost:5000',
  });

  const checkMeet = async () => {
    try {
      const result = await checkLinkConnection();
      setIsMeetConnected(result.connected);
      setMeetStatus(result.connected ? 'Google Meet Active' : (result.message || 'Not on Google Meet'));
    } catch {
      setIsMeetConnected(false);
      setMeetStatus('Google Meet disconnected');
    }
  };

  const openPermissionTab = () => {
    try {
      const url = browser.runtime.getURL('/permission.html');
      browser.tabs.create({ url });
    } catch {
      window.open('/permission.html', '_blank');
    }
  };

  useEffect(() => {
    checkMeet();
  }, []);

  return (
    <div className="w-[380px] p-4 bg-slate-900 text-white font-sans rounded-lg shadow-xl flex flex-col gap-3 min-h-[470px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            MeetLyst
          </h1>
          <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isMeetConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            {meetStatus}
          </p>
        </div>
        <button
          onClick={checkMeet}
          className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition cursor-pointer"
          title="Re-check Google Meet tab"
        >
          Refresh
        </button>
      </div>

      {/* Permission Needed Alert */}
      {isPermissionRequired && (
        <div className="p-3 bg-amber-950/80 border border-amber-700/80 rounded-lg flex flex-col gap-2">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
            <span>⚠️</span>
            <span>Microphone Permission Needed</span>
          </div>
          <p className="text-[11px] text-amber-200/90 leading-tight">
            Chrome does not allow permission prompts inside extension popups. Click below to grant permission in a dedicated tab once.
          </p>
          <button
            onClick={openPermissionTab}
            className="w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded transition shadow cursor-pointer"
          >
            Grant Microphone Permission 🎙️
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2">
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={isConnecting}
            className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-60 text-white font-medium text-sm rounded-md transition flex items-center justify-center gap-2 shadow cursor-pointer"
          >
            {isConnecting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 bg-red-400 rounded-full" />
                Start Live Transcription
              </>
            )}
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex-1 py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white font-medium text-sm rounded-md transition flex items-center justify-center gap-2 shadow animate-pulse cursor-pointer"
          >
            <span className="w-2.5 h-2.5 bg-white rounded-sm" />
            Stop Recording
          </button>
        )}

        <button
          onClick={clearTranscripts}
          disabled={finalTranscripts.length === 0 && !partialTranscript}
          className="py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-sm rounded-md transition cursor-pointer"
          title="Clear transcripts"
        >
          Clear
        </button>
      </div>

      {/* Error Banner (non-permission errors) */}
      {error && !isPermissionRequired && (
        <div className="p-2.5 bg-rose-950/80 border border-rose-800/80 rounded text-xs text-rose-200">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Status Bar */}
      <div className="flex items-center justify-between text-xs px-1 text-slate-400">
        <span>
          Model: <span className="text-slate-300 font-mono">universal-3-6-pro</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              isRecording ? 'bg-red-500 animate-ping' : isConnecting ? 'bg-amber-400' : 'bg-slate-600'
            }`}
          />
          {isRecording ? 'Listening...' : isConnecting ? 'Authenticating...' : 'Idle'}
        </span>
      </div>

      {/* Live Transcript Display Box */}
      <div className="flex-1 bg-slate-950 border border-slate-800 rounded-md p-3 overflow-y-auto max-h-[240px] flex flex-col gap-2 select-text text-sm leading-relaxed">
        {finalTranscripts.length === 0 && !partialTranscript && (
          <div className="m-auto text-center text-slate-500 text-xs py-8">
            Click <strong>Start Live Transcription</strong> and begin speaking. Your voice will appear here in real time.
          </div>
        )}

        {finalTranscripts.map((turnText, index) => (
          <div
            key={index}
            className="p-2 rounded bg-slate-900/90 border border-slate-800 text-slate-200 text-xs"
          >
            {turnText}
          </div>
        ))}

        {/* Real-time partial transcript in-flight */}
        {partialTranscript && (
          <div className="p-2 rounded bg-blue-950/40 border border-blue-800/50 text-blue-200 text-xs italic flex items-start gap-1.5">
            <span className="text-blue-400 font-bold not-italic">›</span>
            <span>{partialTranscript}</span>
          </div>
        )}
      </div>

      {/* Footer / Tip */}
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>AssemblyAI Streaming v3</span>
        <button
          onClick={openPermissionTab}
          className="text-slate-400 hover:text-blue-400 transition underline cursor-pointer"
        >
          Check Mic Permission
        </button>
      </div>
    </div>
  );
}

export default App;
