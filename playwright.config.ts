import { defineConfig, devices } from '@playwright/test'
import { E2E_BASE_URL, E2E_PORT } from './tests/e2e/env'

/**
 * End-to-end tests (`npm run test:e2e`): Chromium against the real app and a seeded throwaway
 * database. Kept out of `npm run check` because they start Postgres and `next dev` (see
 * tests/e2e/README.md).
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  // Every spec resets the same database, so specs run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: E2E_BASE_URL,
    // The mockups are drawn at 1440 wide (docs/design/STYLE.md).
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'tsx tests/e2e/server.ts',
    url: `${E2E_BASE_URL}/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_PORT: String(E2E_PORT) },
  },
})
