/**
 * Release verification gate E2E tests.
 *
 * These tests run against a separate build served on port 4174, compiled with
 * VITE_RELEASE_VERIFICATION_REQUIRED=true.  The `verification-gate` project in
 * playwright.config.ts points to that server.
 *
 * Each test intercepts manifest.json and/or manifest.sig at the network layer
 * to exercise every failure branch in verifyRelease().
 */
import { expect, test } from '@playwright/test';

// A minimal valid manifest JSON (signature check comes after parsing).
const VALID_MANIFEST_JSON = JSON.stringify({
  version: '0.0.0-test',
  commitHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  buildTime: '2026-01-01T00:00:00.000Z',
  files: {},
});

// Valid base64url characters but cryptographically wrong — will fail Ed25519.
const INVALID_SIGNATURE = 'aW52YWxpZHNpZ25hdHVyZXBhZA';

test.describe('release verification gate', () => {
  test('shows Verification Unavailable when manifest.json cannot be fetched', async ({ page }) => {
    await page.route('**/manifest.json', (route) => route.fulfill({ status: 404 }));

    await page.goto('/');

    const gate = page.getByTestId('release-verification-gate');
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText('Verification Unavailable');
    await expect(gate).toContainText('Signed release metadata could not be loaded');
  });

  test('shows Verification Unavailable when manifest.sig cannot be fetched', async ({ page }) => {
    await page.route('**/manifest.json', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: VALID_MANIFEST_JSON,
      })
    );
    await page.route('**/manifest.sig', (route) => route.fulfill({ status: 404 }));

    await page.goto('/');

    const gate = page.getByTestId('release-verification-gate');
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText('Verification Unavailable');
    await expect(gate).toContainText('missing its detached signature');
  });

  test('shows Release Verification Failed when signature is invalid', async ({ page }) => {
    await page.route('**/manifest.json', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: VALID_MANIFEST_JSON,
      })
    );
    await page.route('**/manifest.sig', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: INVALID_SIGNATURE,
      })
    );

    await page.goto('/');

    const gate = page.getByTestId('release-verification-gate');
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText('Release Verification Failed');
    await expect(gate).toContainText('signature did not validate');
  });

  test('shows verifying state before result resolves', async ({ page }) => {
    // Block manifest.json indefinitely to observe the transient verifying state.
    let resolveManifest!: () => void;
    const manifestBlocked = new Promise<void>((resolve) => {
      resolveManifest = resolve;
    });

    let routeDone!: () => void;
    const routeSettled = new Promise<void>((resolve) => {
      routeDone = resolve;
    });

    await page.route('**/manifest.json', async (route) => {
      await manifestBlocked;
      await route.fulfill({ status: 404 });
      routeDone();
    });

    await page.goto('/');

    const gate = page.getByTestId('release-verification-gate');
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText('Verifying ZeroLink release');

    // Unblock so the page can settle (avoids dangling route handlers).
    resolveManifest();
    await routeSettled;
  });
});
