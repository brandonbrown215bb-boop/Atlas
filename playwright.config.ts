import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  // A click that never lands should fail on its own line, not as an anonymous test timeout.
  use: { actionTimeout: 10_000 },
});
