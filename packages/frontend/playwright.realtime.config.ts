import { defineConfig } from '@playwright/test';

import {
  chromiumDesktopProject,
  createPlaywrightWebServer,
  sharedPlaywrightConfig,
} from './playwright.shared';

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: ['**/realtime-smoke.spec.ts'],
  use: {
    ...sharedPlaywrightConfig.use,
    baseURL: 'http://127.0.0.1:4173',
  },
  projects: [chromiumDesktopProject],
  webServer: [
    createPlaywrightWebServer(
      'pnpm --filter @zerolink/frontend build:e2e && pnpm --filter @zerolink/frontend preview --host 127.0.0.1 --port 4173',
      'http://127.0.0.1:4173',
      120_000
    ),
    createPlaywrightWebServer(
      'cd ../backend && pnpm exec wrangler dev --local --ip 127.0.0.1 --port 8787 --persist-to .wrangler/state/e2e --env-file .env.e2e --log-level warn --show-interactive-dev-session=false',
      'http://127.0.0.1:8787/',
      60_000
    ),
  ],
});
