import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'MeetAnalyze',
    description: 'Captures Google Meet captions with speaker names and analyses how the meeting went',
    permissions: ['activeTab', 'tabs', 'storage', 'sidePanel'],
    host_permissions: [
      '*://meet.google.com/*',
      'https://meet.google.com/*',
      'http://localhost:5000/*',
      'http://127.0.0.1:5000/*',
      'https://*.vercel.app/*',
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
