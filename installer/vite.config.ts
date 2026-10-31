import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The installer's UI. It reuses the app's tokens, components and era styles from ../src.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1421, strictPort: true, fs: { allow: ['..'] } },
  build: { target: 'es2021', outDir: 'dist', emptyOutDir: true },
});
