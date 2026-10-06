import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The app talks to the API on the same origin, so the session cookie just works. In development the API
// runs on 8787 (`pnpm dev:demo`) and Vite forwards `/v1` to it.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/v1': 'http://localhost:8787' } },
  // Bryntum is one large module; pre-bundling it keeps it from loading twice in development.
  optimizeDeps: { include: ['@bryntum/gantt'] },
  build: { sourcemap: true },
});
