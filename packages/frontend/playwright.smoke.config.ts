import { defineConfig } from '@playwright/test';

import { chromiumDesktopProject, sharedPlaywrightConfig } from './playwright.shared';

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: ['**/staging-smoke.spec.ts'],
  expect: { timeout: 20_000 },
  use: {
    ...sharedPlaywrightConfig.use,
    baseURL: process.env.STAGING_URL ?? 'https://staging.zerolink.dev',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [chromiumDesktopProject],
});
