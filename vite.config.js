import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build also works from a GitHub Pages sub-path (stage 3).
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  // Local servers listen on loopback only (never 0.0.0.0).
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
});
