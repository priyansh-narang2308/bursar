import { defineConfig } from '@playwright/test';

const PORT = 8790;

/**
 * The whole product, as a deploy runs it: the built web app and the API on one port, on an in-memory database,
 * PayPal's fake and the offline catalog. Locally it drives the Chrome that is installed; in CI it uses the
 * Chromium that `playwright install` fetched.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // every test opens its own workspace, but the demo server is one process
  workers: 1,
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...(process.env['CI'] ? {} : { channel: 'chrome' }),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `sh -c "pnpm --filter @bursar/web build && PORT=${PORT} node --import tsx apps/api/src/dev.ts"`,
    cwd: '../..',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
