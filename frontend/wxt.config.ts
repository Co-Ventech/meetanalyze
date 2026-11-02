import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'MeetAnalyze',
    description: 'Real-time meeting audio capture and transcription',
    permissions: ['activeTab', 'tabs'],
    host_permissions: [
      'http://localhost:5000/*',
      'http://127.0.0.1:5000/*',
      'https://streaming.assemblyai.com/*',
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
