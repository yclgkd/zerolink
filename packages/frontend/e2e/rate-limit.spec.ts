/**
 * Rate-limit (429) behaviour.
 *
 * Both ManagePage and SharePage treat any non-ok, non-404 response as a
 * transient error and surface a warning notice to the user rather than
 * silently falling back to the WAITING channel state.
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

  test('share page surfaces a public-status error on 429', async ({ page }) => {
    await page.goto(`/s/${TEST_UUID}#k=${TEST_LOCK_KEY}`);
    await expect(page.getByTestId('page-share')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('share-public-status-error')).toBeVisible({ timeout: 15_000 });
  });
});
