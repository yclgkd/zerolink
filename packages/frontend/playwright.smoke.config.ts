import { defineConfig } from '@playwright/test';

import { chromiumDesktopProject, sharedPlaywrightConfig } from './playwright.shared';

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: ['**/staging-smoke.spec.ts'],
  use: {
    ...sharedPlaywrightConfig.use,
    baseURL: process.env.STAGING_URL ?? 'https://staging.zerolink.dev',
  },
  projects: [chromiumDesktopProject],
});
