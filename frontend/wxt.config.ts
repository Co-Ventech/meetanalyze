import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Function form so env vars from .env files are available
  manifest: () => {
    // Chrome-extension OAuth client ID from Google Cloud (enables post-meeting relabel via Meet REST API)
    const googleClientId = import.meta.env.WXT_GOOGLE_OAUTH_CLIENT_ID as string | undefined;

    return {
      name: 'MeetAnalyze',
      description: 'Real-time meeting audio capture and transcription',
      permissions: [
        'activeTab',
        'tabs',
        'tabCapture',
        'offscreen',
        'storage',
        'sidePanel',
        'alarms',
        ...(googleClientId ? ['identity'] : []),
      ],
      host_permissions: [
        '*://meet.google.com/*',
        'https://meet.google.com/*',
        'http://localhost:5000/*',
        'http://127.0.0.1:5000/*',
        'https://*.vercel.app/*',
        'https://streaming.assemblyai.com/*',
        'https://meet.googleapis.com/*',
      ],
      ...(googleClientId
        ? {
            oauth2: {
              client_id: googleClientId,
              scopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
            },
          }
        : {}),
    };
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
