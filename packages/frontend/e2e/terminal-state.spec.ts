import { expect, test } from '@playwright/test';

import { installStatefulApiMock } from './support/mock-api';
import { installVirtualAuthenticator } from './support/webauthn';

test.describe('terminal state semantics', () => {
  test('Destroy keeps manage/share unavailable and begin routes return 404', async ({ page }) => {
    await installStatefulApiMock(page);
    const authenticator = await installVirtualAuthenticator(page);

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('page-create')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('mode-card-secure').click();
      await expect(page.getByTestId('create-submit-button')).toBeEnabled();
      await page.getByTestId('create-submit-button').click();

      const shareUrl = await page.getByTestId('create-success-share-link').getAttribute('href');
      const manageUrl = await page.getByTestId('create-success-manage-link').getAttribute('href');

      expect(shareUrl, 'share link should exist').toBeTruthy();
      expect(manageUrl, 'manage link should exist').toBeTruthy();

      const shareMatch = shareUrl?.match(/^\/s\/([A-Za-z0-9_-]{21})#k=([A-Za-z0-9_-]+)$/u);
      expect(shareMatch, 'share link should contain uuid and lock secret fragment').toBeTruthy();
      const uuid = shareMatch?.[1] ?? '';

      await page.goto(manageUrl ?? '/');
      await expect(page.getByTestId('page-manage')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('manage-destroy-button').click();
      await page.getByTestId('manage-destroy-confirm-apply').click();

      await expect(page.getByTestId('manage-state-deleted')).toBeVisible({ timeout: 15_000 });

      await page.goto(manageUrl ?? '/');
      await expect(page.getByTestId('manage-state-unavailable')).toBeVisible({ timeout: 15_000 });

      const routeResponses = await page.evaluate(async (channelUuid) => {
        const [publicResponse, lockBeginResponse, compoundBeginResponse] = await Promise.all([
          fetch(`/api/public/${channelUuid}`),
          fetch(`/api/lock_begin/${channelUuid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid: channelUuid }),
          }),
          fetch(`/api/manage/compound_begin/${channelUuid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid: channelUuid }),
          }),
        ]);

        return {
          publicStatus: publicResponse.status,
          publicBody: await publicResponse.json(),
          lockBeginStatus: lockBeginResponse.status,
          lockBeginBody: await lockBeginResponse.json(),
          compoundBeginStatus: compoundBeginResponse.status,
          compoundBeginBody: await compoundBeginResponse.json(),
        };
      }, uuid);

      expect(routeResponses.publicStatus).toBe(404);
      expect(routeResponses.publicBody).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(routeResponses.lockBeginStatus).toBe(404);
      expect(routeResponses.lockBeginBody).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(routeResponses.compoundBeginStatus).toBe(404);
      expect(routeResponses.compoundBeginBody).toEqual({ ok: false, code: 'NOT_FOUND' });

      await page.goto(shareUrl ?? '/');
      await expect(page.getByTestId('share-step-unavailable')).toBeVisible({ timeout: 15_000 });
    } finally {
      await authenticator.teardown();
    }
  });
});
