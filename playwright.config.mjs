import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT || 3100);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.mjs',
  // One shared local database, so the flows run in order, one at a time.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Locally use the installed Chrome (no download); CI installs Playwright's own Chromium and sets E2E_BROWSER=chromium.
    ...(process.env.E2E_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
  },
  // A phone-sized, touch-enabled screen: this is the product's primary surface. (isMobile is off because Chrome's mobile
  // emulation inflates the layout viewport by the scrollbar width, which makes fixed bars unclickable for the driver.)
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'], isMobile: false, channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome' } }],
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: `http://localhost:${port}/api/assistant`,
    // 401 is not "ready"; any HTTP answer from the app is. (Local identity makes this 200.)
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
