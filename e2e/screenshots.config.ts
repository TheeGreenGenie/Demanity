import { defineConfig, devices } from '@playwright/test';

// Design review: captures key screens at phone size. Not part of the test
// suite. Run: pnpm --filter @demanity/e2e exec playwright test -c screenshots.config.ts
export default defineConfig({
  testDir: './screenshots',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    channel: 'chrome',
    headless: true,
    baseURL: 'http://localhost:8081',
    colorScheme: 'dark',
  },
});
