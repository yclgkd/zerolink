import { expect, test } from '@playwright/test';

import { installStatefulApiMock } from './support/mock-api';
import { installVirtualAuthenticator } from './support/webauthn';

test.describe('share link fragment cleanup', () => {
  test('removes #k from the URL while preserving refresh and trust-page return before lock', async ({
    page,
  }) => {
    await installStatefulApiMock(page);
    const authenticator = await installVirtualAuthenticator(page);

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      await expect(page.getByTestId('page-create')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('mode-card-secure').click();
      await page.getByTestId('create-submit-button').click();

      const shareLinkLocator = page.getByTestId('create-success-share-link');
      await expect(shareLinkLocator).toBeVisible({ timeout: 15_000 });
      const shareUrl = (await shareLinkLocator.textContent())?.trim() ?? null;

      expect(shareUrl, 'share link should exist').toBeTruthy();
      await page.goto(shareUrl ?? '/', { waitUntil: 'domcontentloaded' });

      await expect(page.getByTestId('share-step-onboarding')).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() => page.url(), {
          timeout: 15_000,
        })
        .not.toContain('#k=');

      await page.getByTestId('app-shell-trust-link').click();
      await expect(page.getByTestId('page-trust')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('trust-back-button').click();
      await expect(page.getByTestId('share-step-onboarding')).toBeVisible({ timeout: 15_000 });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('share-step-onboarding')).toBeVisible({ timeout: 15_000 });

      await page.getByTestId('share-continue-button').click();
      await expect(page.getByTestId('share-step-lock')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('passphrase-input-field').fill('CorrectHorseBatteryStaple!123');
      await page.getByTestId('share-generate-button').click();

      await expect(page.getByTestId('share-step-locked')).toBeVisible({ timeout: 15_000 });
    } finally {
      await authenticator.teardown();
    }
  });
});
