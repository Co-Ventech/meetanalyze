import { useState, useEffect } from 'react';
import './App.css';
import { checkLinkConnection } from '../utils/check-google-meet-connection';
import { useRealtimeTranscription } from './hooks/useRealtimeTranscription';

function App() {
  const [meetStatus, setMeetStatus] = useState('Checking Google Meet...');
  const [isMeetConnected, setIsMeetConnected] = useState(false);
  const [joinToast, setJoinToast] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [insightMessage, setInsightMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const {
    isRecording,
    isConnecting,
    isTabAudioCaptured,
    isPermissionRequired,
    partialTranscript,
    finalTranscripts,
    speakerInfo,
    error,
    startRecording,
    stopRecording,
    clearTranscripts,
    setGuestName,
  } = useRealtimeTranscription({
    apiBaseUrl: (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:2000',
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
      const url = browser.runtime.getURL('/permission.html' as any);
      browser.tabs.create({ url });
    } catch {
      window.open('/permission.html', '_blank');
    }
  };

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

  const handleEditGuest = (targetName?: string) => {
    const currentName = targetName || (speakerInfo?.guests?.length ? speakerInfo.guests[0] : '');
    const newName = window.prompt(`Rename or correct participant name ("${currentName || 'Client'}"):`, currentName || 'Client');
    if (newName && newName.trim()) {
      setGuestName(newName.trim(), targetName);
    }
  };

  useEffect(() => {
    checkMeet();
  }, []);

  useEffect(() => {
    if (speakerInfo?.newlyJoined && speakerInfo.newlyJoined.length > 0) {
      const latest = speakerInfo.newlyJoined[speakerInfo.newlyJoined.length - 1];
      if (latest) {
        setJoinToast(latest);
        const timer = setTimeout(() => {
          setJoinToast(null);
        }, 4000);
        return () => clearTimeout(timer);
      }
    }
  }, [speakerInfo?.newlyJoined]);

  const handleShowMeetingInsight = async () => {
    try {
      setInsightMessage(null);

      // Collect complete transcripts
      const activeTranscripts = [...finalTranscripts];
      if (partialTranscript?.text?.trim()) {
        activeTranscripts.push({
          id: `partial_${Date.now()}`,
          speaker: partialTranscript.speaker,
          isSelf: partialTranscript.isSelf,
          text: partialTranscript.text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      }

      if (activeTranscripts.length === 0) {
        window.alert('Please record or enter a meeting transcript first to generate meeting insights.');
        return;
      }

      setIsSummarizing(true);

      const apiBaseUrl = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:2000';
      let response = await fetch(`${apiBaseUrl}/api/v1/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript: activeTranscripts,
        }),
      });

      // Fallback in case of route prefix differences
      if (response.status === 404) {
        response = await fetch(`${apiBaseUrl}/api/v1/transcription/summarize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transcript: activeTranscripts,
          }),
        });
      }

      if (!response.ok) {
        let errorMsg = `Server returned HTTP ${response.status}`;
        try {
          const errData = await response.json();
          if (errData?.message) errorMsg = errData.message;
        } catch {}
        throw new Error(errorMsg);
      }

      // Download doc file blob
      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      let filename = 'Meeting_Insight_Report.doc';
      const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1];
      }

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setInsightMessage({
        type: 'success',
        text: `Downloaded ${filename}`,
      });
      setTimeout(() => setInsightMessage(null), 7000);
    } catch (err: any) {
      console.error('[MeetAnalyze] Insight generation failed:', err);
      setInsightMessage({
        type: 'error',
        text: err?.message || 'Failed to generate meeting insight document.',
      });
    } finally {
      setIsSummarizing(false);
    }
  };

  const guestDisplayName = speakerInfo?.guests?.length
    ? speakerInfo.guests.join(', ')
    : isRecording
    ? (isTabAudioCaptured ? 'Listening for Client...' : 'Tab audio inactive')
    : 'Client';

  return (
    <div className="w-full max-w-[420px] min-w-[340px] p-4 bg-slate-900 text-white font-sans rounded-lg shadow-xl flex flex-col gap-3 min-h-[490px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            MeetAnalyze
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
        <div className="flex items-center gap-1.5">
          <button
            onClick={openSidePanel}
            className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition cursor-pointer flex items-center gap-1"
            title="Dock to Chrome Side Panel (keeps view open during meeting)"
          >
            <span>📌</span>
            <span>Side Panel</span>
          </button>
          <button
            onClick={checkMeet}
            className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition cursor-pointer"
            title="Re-check Google Meet tab"
          >
            Refresh
          </button>
        </div>
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

      {/* Active Audio Channel Badges */}
      <div className="flex items-center gap-2 text-[11px]">
        <div
          className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded border ${
            isRecording
              ? 'bg-blue-950/60 border-blue-700/60 text-blue-300'
              : 'bg-slate-950 border-slate-800 text-slate-500'
          }`}
        >
          <span>🎙️</span>
          <span>Your Mic: {isRecording ? 'Active' : 'Off'}</span>
        </div>

        <div
          className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded border ${
            isRecording && isTabAudioCaptured
              ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
              : isRecording && !isTabAudioCaptured
              ? 'bg-amber-950/60 border-amber-700/60 text-amber-300 animate-pulse'
              : 'bg-slate-950 border-slate-800 text-slate-500'
          }`}
        >
          <span>🔊</span>
          <span>
            Client Audio:{' '}
            {isRecording
              ? isTabAudioCaptured
                ? 'Active'
                : 'Not Found'
              : isMeetConnected
              ? 'Ready'
              : 'Off'}
          </span>
        </div>

        <div
          className="flex items-center justify-center gap-1 py-1 px-2 rounded border bg-slate-950 border-slate-800 text-slate-400 text-[10px]"
          title="Live transcription restricted to English only"
        >
          <span>🌐</span>
          <span>EN</span>
        </div>
      </div>

      {/* Dynamic New Joiner Banner */}
      {joinToast && (
        <div className="p-1.5 bg-indigo-950/90 border border-indigo-700/80 rounded text-[11px] text-indigo-200 flex items-center justify-between shadow transition-all">
          <div className="flex items-center gap-1.5">
            <span>👋</span>
            <span>
              <strong>{joinToast}</strong> joined the meeting
            </span>
          </div>
          <button
            onClick={() => setJoinToast(null)}
            className="text-[10px] text-indigo-400 hover:text-white px-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Dynamic Call Participants Roster */}
      <div className="bg-slate-950/70 border border-slate-800/80 rounded-md p-2 text-[11px] flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 font-medium text-[10px] uppercase tracking-wider">
            Call Participants ({1 + (speakerInfo?.guests?.length || 0)}):
          </span>
          <span className="text-[10px] text-slate-500">
            {speakerInfo?.activeSpeaker ? `🗣️ ${speakerInfo.activeSpeaker} speaking` : 'Listening...'}
          </span>
        </div>

        <div className="flex items-center flex-wrap gap-1.5">
          {/* Local User Chip */}
          <span
            className="px-2 py-0.5 rounded bg-blue-950/80 border border-blue-800/80 text-blue-300 flex items-center gap-1 text-[11px]"
            title={`Local Speaker: ${speakerInfo?.selfName || 'You'}`}
          >
            <span>🎙️</span>
            <span>{speakerInfo?.selfName && speakerInfo.selfName !== 'You' ? `${speakerInfo.selfName} (You)` : 'You'}</span>
          </span>

          {/* Guest Chips */}
          {speakerInfo?.guests && speakerInfo.guests.length > 0 ? (
            speakerInfo.guests.map((guest) => {
              const isCurrentlySpeaking =
                speakerInfo.activeSpeaker?.toLowerCase() === guest.toLowerCase();
              return (
                <button
                  key={guest}
                  onClick={() => handleEditGuest(guest)}
                  className={`px-2 py-0.5 rounded border text-[11px] flex items-center gap-1 transition-all cursor-pointer ${
                    isCurrentlySpeaking
                      ? 'bg-emerald-900/80 border-emerald-500 text-emerald-200 ring-1 ring-emerald-400/50 shadow-sm'
                      : 'bg-emerald-950/70 border-emerald-800/70 text-emerald-300 hover:bg-emerald-900/50'
                  }`}
                  title={`Click to rename ${guest}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isCurrentlySpeaking ? 'bg-emerald-400 animate-ping' : 'bg-emerald-500'
                    }`}
                  />
                  <span>🔊 {guest}</span>
                  <span className="text-[9px] text-emerald-500 hover:text-white">✏️</span>
                </button>
              );
            })
          ) : (
            <span className="text-[11px] text-slate-500 italic flex items-center gap-1 px-1">
              <span>🔊</span>
              <span>
                {isRecording
                  ? (isTabAudioCaptured ? 'Waiting for participants to speak...' : 'Tab audio inactive')
                  : 'Ready for meeting'}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Warning if recording but Google Meet guest audio was not captured */}
      {isRecording && !isTabAudioCaptured && (
        <div className="p-2 bg-amber-950/70 border border-amber-700/60 rounded text-[11px] text-amber-200 flex items-center gap-1.5">
          <span>⚠️</span>
          <span>Only your microphone is currently active. Open/join your Google Meet call to transcribe other participants.</span>
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
          disabled={finalTranscripts.length === 0 && !partialTranscript?.text}
          className="py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-sm rounded-md transition cursor-pointer"
          title="Clear transcripts"
        >
          Clear
        </button>
      </div>

      {/* Show Meeting Insight Button */}
      <button
        onClick={handleShowMeetingInsight}
        disabled={isSummarizing || (finalTranscripts.length === 0 && !partialTranscript?.text)}
        className="w-full py-2 px-3 bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-xs rounded-md transition-all flex items-center justify-center gap-1.5 shadow cursor-pointer"
        title="Analyze sales performance against evaluation rubric and download Word (.doc) report"
      >
        {isSummarizing ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span>Analyzing & Generating Insight Doc...</span>
          </>
        ) : (
          <>
            <span>📊</span>
            <span>Show Meeting Insight</span>
            <span className="text-[10px] bg-black/25 px-1.5 py-0.5 rounded opacity-80 font-mono">.doc</span>
          </>
        )}
      </button>

      {/* Insight Status Alert */}
      {insightMessage && (
        <div
          className={`p-2 rounded text-xs flex items-center justify-between gap-1.5 ${
            insightMessage.type === 'success'
              ? 'bg-emerald-950/80 border border-emerald-700/80 text-emerald-200'
              : 'bg-rose-950/80 border border-rose-800/80 text-rose-200'
          }`}
        >
          <span className="truncate">{insightMessage.type === 'success' ? '✅' : '⚠️'} {insightMessage.text}</span>
          <button
            onClick={() => setInsightMessage(null)}
            className="text-[10px] text-slate-400 hover:text-white px-1 shrink-0 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error Banner */}
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
          {isRecording ? 'Listening to Call...' : isConnecting ? 'Connecting...' : 'Idle'}
        </span>
      </div>

      {/* Live Transcript Display Box with Speaker Diarization */}
      <div className="flex-1 bg-slate-950/90 border border-slate-800 rounded-md p-3 overflow-y-auto max-h-[260px] flex flex-col gap-2.5 select-text text-xs leading-relaxed">
        {finalTranscripts.length === 0 && !partialTranscript?.text && (
          <div className="m-auto text-center text-slate-500 text-xs py-8">
            Click <strong>Start Live Transcription</strong> while in Google Meet. Both your voice and other participants will be transcribed with distinct speaker identification.
          </div>
        )}

        {finalTranscripts.map((turn) => {
          if (turn.systemNotice) {
            return (
              <div
                key={turn.id}
                className="self-center my-0.5 px-2.5 py-0.5 bg-slate-800/60 border border-slate-700/50 rounded-full text-[10px] text-slate-400 flex items-center gap-1.5 shadow-sm"
              >
                <span>👋</span>
                <span className="font-medium text-slate-300">{turn.text}</span>
                {turn.timestamp && (
                  <span className="text-[9px] text-slate-500">({turn.timestamp})</span>
                )}
              </div>
            );
          }

          return (
            <div
              key={turn.id}
              className={`p-2.5 rounded-lg border flex flex-col gap-1 transition-all ${
                turn.isSelf
                  ? 'bg-blue-950/30 border-blue-800/60 self-end max-w-[90%]'
                  : 'bg-emerald-950/30 border-emerald-800/60 self-start max-w-[90%]'
              }`}
            >
              <div className="flex items-center justify-between gap-3 text-[11px] font-medium border-b border-white/5 pb-1">
                <span
                  onClick={!turn.isSelf ? () => handleEditGuest(turn.speaker) : undefined}
                  className={`flex items-center gap-1 font-semibold ${
                    turn.isSelf ? 'text-blue-300' : 'text-emerald-300 cursor-pointer hover:underline'
                  }`}
                  title={!turn.isSelf ? `Click to rename ${turn.speaker}` : undefined}
                >
                  <span>{turn.isSelf ? '🎙️' : '🔊'}</span>
                  <span>{turn.speaker}</span>
                  {!turn.isSelf && (
                    <span className="text-[10px] text-slate-500 hover:text-amber-400 font-normal">✏️</span>
                  )}
                </span>
                {turn.timestamp && (
                  <span className="text-[10px] text-slate-500 font-normal">{turn.timestamp}</span>
                )}
              </div>
              <p className="text-slate-200 text-xs pt-0.5 leading-relaxed">{turn.text}</p>
            </div>
          );
        })}

        {/* Real-time partial transcript in-flight */}
        {partialTranscript?.text && (
          <div
            className={`p-2.5 rounded-lg border flex flex-col gap-1 animate-pulse ${
              partialTranscript.isSelf
                ? 'bg-blue-950/20 border-blue-700/50 self-end max-w-[90%]'
                : 'bg-emerald-950/20 border-emerald-700/50 self-start max-w-[90%]'
            }`}
          >
            <div className="flex items-center gap-1 text-[11px] font-semibold">
              <span className={partialTranscript.isSelf ? 'text-blue-400' : 'text-emerald-400'}>
                {partialTranscript.isSelf ? '🎙️ ' : '🔊 '}
                {partialTranscript.speaker}
              </span>
              <span className="text-[10px] text-slate-400 font-normal italic">(speaking...)</span>
            </div>
            <p className="text-slate-300 text-xs italic">{partialTranscript.text}</p>
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
