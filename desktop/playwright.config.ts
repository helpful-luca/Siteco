import { defineConfig } from '@playwright/test';

/** Electron smoke test (`npm run test:e2e`). Not part of CI: it needs a display and the running stack. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
});
