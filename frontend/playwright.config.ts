import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a running stack (`docker compose up` with LLM_PROVIDER=fake for the chat specs,
 * without a key for the search-only spec). `scripts/e2e.sh` starts both. Specs skip themselves
 * when the stack is in the other mode, so `npm run test:e2e` is safe to point at either.
 */
const run = process.env.E2E_RUN ?? 'default'; // one folder per stack mode, so the second run keeps the first one's traces

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  outputDir: `test-results/${run}`,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: `playwright-report/${run}` }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    // E2E_CHANNEL=chrome renders backdrop blur like desktop Chrome; CI uses the bundled Chromium.
    channel: process.env.E2E_CHANNEL || undefined,
    locale: 'en-US',
    trace: process.env.CI ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
});
