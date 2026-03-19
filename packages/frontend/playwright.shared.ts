import { devices, type ReporterDescription } from '@playwright/test';

const listReporter: ReporterDescription = ['list'];
const htmlReporter: ReporterDescription = ['html', { open: 'never' }];

export const sharedPlaywrightConfig = {
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [listReporter, htmlReporter] : [listReporter],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
};

export const chromiumDesktopProject = {
  name: 'chromium',
  use: { ...devices['Desktop Chrome'] },
};

type PlaywrightWebServerOptions = {
  reuseExistingServer?: boolean;
};

export function createPlaywrightWebServer(
  command: string,
  url: string,
  timeout: number,
  options: PlaywrightWebServerOptions = {}
) {
  return {
    command,
    url,
    reuseExistingServer: options.reuseExistingServer ?? !process.env.CI,
    timeout,
  };
}
