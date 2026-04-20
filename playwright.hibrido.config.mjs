import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/hibrido',
  timeout: 900_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    headless: true,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
