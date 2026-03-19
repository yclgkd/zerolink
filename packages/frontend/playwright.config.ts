import { defineConfig } from '@playwright/test';

import {
  chromiumDesktopProject,
  createPlaywrightWebServer,
  sharedPlaywrightConfig,
} from './playwright.shared';

export default defineConfig({
  ...sharedPlaywrightConfig,
  testIgnore: ['**/manifest-verification.spec.ts', '**/realtime-smoke.spec.ts'],
  use: {
    ...sharedPlaywrightConfig.use,
    baseURL: 'http://127.0.0.1:4173',
  },
  projects: [chromiumDesktopProject],
  webServer: createPlaywrightWebServer(
    'pnpm --filter @zerolink/frontend build:e2e && pnpm --filter @zerolink/frontend preview --host 127.0.0.1 --port 4173',
    'http://127.0.0.1:4173',
    120_000
  ),
});
