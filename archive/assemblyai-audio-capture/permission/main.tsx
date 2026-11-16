import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@/entrypoints/popup/style.css';

function PermissionPage() {
  const [granted, setGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setGranted(true);
      setError(null);
      setTimeout(() => {
        window.close();
      }, 2000);
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(e);
      setError(e.message || 'Microphone access denied. Please click the camera/mic icon in the address bar to allow.');
    }
  };

  return (
    <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-8 text-center shadow-2xl flex flex-col items-center gap-4">
      <div className="w-16 h-16 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center text-3xl">
        🎙️
      </div>
      <h1 className="text-2xl font-bold text-white">Microphone Access Needed</h1>
      <p className="text-sm text-slate-400 leading-relaxed">
        Google Chrome requires you to grant microphone permission once in a browser tab before the extension popup can record audio.
      </p>

      {granted ? (
        <div className="w-full p-4 bg-emerald-950/80 border border-emerald-800 rounded-lg text-emerald-300 text-sm flex flex-col gap-1 items-center">
          <span className="font-semibold text-base">✓ Permission Granted!</span>
          <span className="text-xs text-emerald-400">Closing this tab... You can now return to the MeetLyst popup.</span>
        </div>
      ) : (
        <button
          onClick={requestMic}
          className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-500 cursor-pointer text-white font-medium text-base rounded-lg shadow-lg transition"
        >
          Allow Microphone Access
        </button>
      )}

      {error && (
        <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg text-rose-300 text-xs text-left">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PermissionPage />
  </React.StrictMode>
);

