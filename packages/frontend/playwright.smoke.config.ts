import { defineConfig } from '@playwright/test';

import { chromiumDesktopProject, sharedPlaywrightConfig } from './playwright.shared';

declare const process: {
  env: Record<string, string | undefined>;
};

const { STAGING_URL } = process.env;

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: ['**/staging-smoke.spec.ts'],
  expect: { timeout: 20_000 },
  use: {
    ...sharedPlaywrightConfig.use,
    baseURL: STAGING_URL ?? 'https://staging.zerolink.dev',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [chromiumDesktopProject],
});
