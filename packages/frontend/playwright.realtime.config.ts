import { defineConfig } from '@playwright/test';

import {
  chromiumDesktopProject,
  createPlaywrightWebServer,
  sharedPlaywrightConfig,
} from './playwright.shared';

const realtimeServerHost = '127.0.0.1';
const realtimeServerPort = 8788;
const realtimeServerUrl = `http://${realtimeServerHost}:${realtimeServerPort}`;

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: ['**/realtime-smoke.spec.ts'],
  use: {
    ...sharedPlaywrightConfig.use,
    baseURL: realtimeServerUrl,
  },
  projects: [chromiumDesktopProject],
  // Serve the built frontend through the backend worker so realtime smoke tests
  // exercise the worker-managed websocket path directly. The dedicated env file
  // keeps RP_ORIGIN aligned with Wrangler local's route host rewrite.
  webServer: createPlaywrightWebServer(
    `pnpm --filter @zerolink/frontend build:e2e && cd ../backend && pnpm exec wrangler dev --local --ip ${realtimeServerHost} --port ${realtimeServerPort} --persist-to .wrangler/state/e2e --env-file .env.e2e.realtime --log-level warn --show-interactive-dev-session=false`,
    realtimeServerUrl,
    180_000,
    { reuseExistingServer: false }
  ),
});
