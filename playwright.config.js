// End-to-end tests on the production build (npm run build first; CI does it).
// Locally the installed Microsoft Edge is used (no 150 MB browser download);
// in CI Playwright's own Chromium is installed. Only one browser engine: Chromium.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:' + PORT + '/',
    trace: 'retain-on-failure',
    ...(process.env.CI ? {} : { channel: 'msedge' })
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...(process.env.CI ? {} : { channel: 'msedge' }) }, testIgnore: /screenshots/ },
    { name: 'screenshots', use: { ...(process.env.CI ? {} : { channel: 'msedge' }) }, testMatch: /screenshots/ }
  ],
  webServer: {
    // serves dist/ on loopback only
    command: 'npx vite preview --host 127.0.0.1 --port ' + PORT + ' --strictPort',
    url: 'http://127.0.0.1:' + PORT + '/',
    reuseExistingServer: false,
    timeout: 60000
  }
});
