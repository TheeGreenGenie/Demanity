import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real web app (Expo web export) against the real
// API and identity vault, with a virtual WebAuthn authenticator standing in
// for the user's device. Uses the locally installed Chrome (no browser download).
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    headless: true,
    baseURL: 'http://localhost:8081',
    trace: 'retain-on-failure',
  },
});
