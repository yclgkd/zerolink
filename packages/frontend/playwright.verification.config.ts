import { defineConfig } from '@playwright/test';

import {
  chromiumDesktopProject,
  createPlaywrightWebServer,
  sharedPlaywrightConfig,
} from './playwright.shared';

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: ['**/manifest-verification.spec.ts'],
  use: {
    ...sharedPlaywrightConfig.use,
    baseURL: 'http://127.0.0.1:4173',
  },
  projects: [
    {
      ...chromiumDesktopProject,
      name: 'verification-gate',
    },
  ],
  // This suite runs in a separate command and CI job, so it can reuse the
  // standard preview port while serving the verification-only build output.
  webServer: createPlaywrightWebServer(
    'pnpm --filter @zerolink/frontend build:verification:e2e && pnpm --filter @zerolink/frontend preview --outDir dist-verification --host 127.0.0.1 --port 4173',
    'http://127.0.0.1:4173',
    180_000
  ),
});
