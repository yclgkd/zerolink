import { devices, type PlaywrightTestConfig, type ReporterDescription } from '@playwright/test';

declare const process: {
  env: Record<string, string | undefined>;
};

const listReporter: ReporterDescription = ['list'];
const htmlReporter: ReporterDescription = ['html', { open: 'never' }];
const { CI } = process.env;
const isCI = Boolean(CI);
const sharedUse: NonNullable<PlaywrightTestConfig['use']> = {
  trace: 'on-first-retry',
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
};

export const sharedPlaywrightConfig = {
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? [listReporter, htmlReporter] : [listReporter],
  use: sharedUse,
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
    reuseExistingServer: options.reuseExistingServer ?? !isCI,
    timeout,
  };
}
