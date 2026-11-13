import { defineConfig } from 'vite';
import pwaPlugin from './scripts/pwa-plugin.mjs';

export default defineConfig({
  // Relative base so the build also works from a GitHub Pages sub-path (stage 3).
  base: './',
  plugins: [pwaPlugin()],
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  // Local servers listen on loopback only (never 0.0.0.0).
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
});
