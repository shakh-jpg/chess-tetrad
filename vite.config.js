import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build also works from a GitHub Pages sub-path (stage 3).
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
});
