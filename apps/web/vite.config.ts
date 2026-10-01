import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // During local dev the API runs separately (pnpm dev:api); in production both share one origin on Vercel.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
