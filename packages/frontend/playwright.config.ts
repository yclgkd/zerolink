import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/manifest-verification.spec.ts'],
    },
    {
      name: 'verification-gate',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4174',
      },
      testMatch: ['**/manifest-verification.spec.ts'],
    },
  ],
  webServer: [
    {
      command:
        'pnpm --filter @zerolink/frontend build && pnpm --filter @zerolink/frontend preview --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        'pnpm --filter @zerolink/frontend build -- --outDir dist-verification && pnpm --filter @zerolink/frontend exec vite preview --outDir dist-verification --host 127.0.0.1 --port 4174',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        VITE_RELEASE_VERIFICATION_REQUIRED: 'true',
      },
    },
  ],
});
