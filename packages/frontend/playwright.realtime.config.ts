import { defineConfig } from '@playwright/test';

import {
  chromiumDesktopProject,
  createPlaywrightWebServer,
  sharedPlaywrightConfig,
} from './playwright.shared';

const realtimeBackendHost = '127.0.0.1';
const realtimeBackendPort = 8788;
const realtimeBackendUrl = `http://${realtimeBackendHost}:${realtimeBackendPort}/`;
const realtimeFrontendProxyEnv = `export ZEROLINK_API_PROXY_HOST=${realtimeBackendHost} ZEROLINK_API_PROXY_PORT=${realtimeBackendPort}`;

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
      `${realtimeFrontendProxyEnv} && pnpm --filter @zerolink/frontend build:e2e && pnpm --filter @zerolink/frontend preview --host 127.0.0.1 --port 4173`,
      'http://127.0.0.1:4173',
      120_000
    ),
    createPlaywrightWebServer(
      `cd ../backend && pnpm exec wrangler dev --local --ip ${realtimeBackendHost} --port ${realtimeBackendPort} --persist-to .wrangler/state/e2e --env-file .env.e2e --log-level warn --show-interactive-dev-session=false`,
      realtimeBackendUrl,
      60_000,
      { reuseExistingServer: false }
    ),
  ],
});
