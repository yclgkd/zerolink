/**
 * Rate-limit (429) behaviour.
 *
 * Known behaviour at time of writing:
 *   - ManagePage treats any non-ok, non-404 response as an error and surfaces
 *     a warning via `manage-public-status-error`.
 *   - SharePage silently falls back to the WAITING channel state when the
 *     response body fails schema validation.  A 429 response body is not a
 *     valid PublicStatusResponse, so the page renders the normal onboarding
 *     step rather than an explicit error — this is a known limitation.
 */
import { expect, test } from '@playwright/test';

const TEST_UUID = 'AAAAAAAAAAAAAAAAAAAAA';
const TEST_LOCK_KEY = 'dGVzdGtleQ';

test.describe('rate limit (429) handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/public/**', async (route) => {
      await route.fulfill({
        status: 429,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, code: 'RATE_LIMITED' }),
      });
    });
  });

  test('manage page surfaces a public-status error on 429', async ({ page }) => {
    await page.goto(`/m/${TEST_UUID}`);
    await expect(page.getByTestId('page-manage')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('manage-public-status-error')).toBeVisible({ timeout: 15_000 });
  });

  test('share page silently falls back to waiting state on 429 — does not crash', async ({
    page,
  }) => {
    // Known limitation: the share page has no dedicated 429 handler.  When the
    // API returns 429 the response body fails PublicStatusResponseSchema, so
    // the page falls back to the WAITING/onboarding step instead of showing an
    // explicit error.  This test documents and pins that behaviour.
    await page.goto(`/s/${TEST_UUID}#k=${TEST_LOCK_KEY}`);
    await expect(page.getByTestId('page-share')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('share-step-unavailable')).not.toBeVisible({ timeout: 15_000 });
  });
});
