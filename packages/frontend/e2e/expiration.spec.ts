import { expect, test } from '@playwright/test';

const TEST_UUID = 'AAAAAAAAAAAAAAAAAAAAA';
const TEST_LOCK_KEY = 'dGVzdGtleQ';

test.describe('expiration flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/public/**', async (route) => {
      await route.fulfill({
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, code: 'NOT_FOUND' }),
      });
    });
  });

  test('share page shows unavailable when channel not found', async ({ page }) => {
    await page.goto(`/s/${TEST_UUID}#k=${TEST_LOCK_KEY}`);
    await expect(page.getByTestId('share-step-unavailable')).toBeVisible({ timeout: 15_000 });
  });

  test('manage page shows unavailable when channel not found', async ({ page }) => {
    await page.goto(`/m/${TEST_UUID}`);
    await expect(page.getByTestId('manage-state-unavailable')).toBeVisible({ timeout: 15_000 });
  });
});
