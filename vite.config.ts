import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed dev port and no browser auto-open.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  // index.html is the app; nudge.html the small break-nudge window.
  build: { target: 'es2021', outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { main: 'index.html', nudge: 'nudge.html' } } },
});
