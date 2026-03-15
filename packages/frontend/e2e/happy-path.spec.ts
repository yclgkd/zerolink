import { expect, test } from '@playwright/test';

import { installStatefulApiMock } from './support/mock-api';
import { installVirtualAuthenticator } from './support/webauthn';

test.describe('ZL-032 e2e happy path', () => {
  test('Create -> Lock -> Deliver -> Decrypt -> Local Burn -> Re-decrypt', async ({ page }) => {
    await installStatefulApiMock(page);
    const authenticator = await installVirtualAuthenticator(page);
    const passphrase = 'CorrectHorseBatteryStaple!123';
    const plaintext = 'ZeroLink e2e secret payload';

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('page-create')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('mode-card-quick')).toHaveAttribute('aria-pressed', 'true', {
        timeout: 15_000,
      });
      await page.getByTestId('mode-card-secure').click();
      await expect(page.getByTestId('mode-card-secure')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('create-submit-button')).toBeEnabled();
      await page.getByTestId('create-submit-button').click();

      const shareLinkLocator = page.getByTestId('create-success-share-link');
      const manageLinkLocator = page.getByTestId('create-success-manage-link');
      await expect(shareLinkLocator).toBeVisible({ timeout: 15_000 });
      await expect(manageLinkLocator).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('create-success-share-link-warning')).toContainText(
        'This share link is shown only once.',
        { timeout: 15_000 }
      );
      await expect(page.getByTestId('create-success-share-link-warning')).toContainText(
        'After you leave this page, ZeroLink cannot recover it.'
      );

      const shareUrl = await shareLinkLocator.getAttribute('href');
      const manageUrl = await manageLinkLocator.getAttribute('href');

      expect(shareUrl, 'share link should exist').toBeTruthy();
      expect(manageUrl, 'manage link should exist').toBeTruthy();

      const shareMatch = shareUrl?.match(
        /^\/s\/([A-Za-z0-9_-]{21})#k=([A-Za-z0-9_-]+)&af=([0-9a-f]{64})$/u
      );
      expect(
        shareMatch,
        'share link should contain uuid, lock secret fragment, and sender auth fingerprint'
      ).toBeTruthy();

      const uuid = shareMatch?.[1] ?? '';
      expect(manageUrl).toBe(`/m/${uuid}`);

      await page.goto(shareUrl ?? '/');

      await expect(page.getByTestId('share-step-onboarding')).toBeVisible();
      await page.getByTestId('share-continue-button').click();

      await expect(page.getByTestId('share-step-lock')).toBeVisible();
      await page.getByTestId('passphrase-input-field').fill(passphrase);
      await page.getByTestId('share-generate-button').click();

      await expect(page.getByTestId('share-step-locked')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('safety-code-root')).toBeVisible({ timeout: 15_000 });

      await page.goto(manageUrl ?? '/');
      await expect(page.getByTestId('page-manage')).toBeVisible();
      await expect(page.getByTestId('manage-share-link-card')).toHaveCount(0);
      await expect(page.getByTestId('manage-copy-button')).toHaveCount(0);

      await page.getByTestId('manage-secret-input').fill(plaintext);
      await page.getByTestId('manage-deliver-button').click();

      await expect(page.getByTestId('manage-state-delivered')).toBeVisible({ timeout: 15_000 });

      await page.goto(shareUrl ?? '/');
      await expect(page.getByTestId('share-step-delivered')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('share-decrypt-panel')).toBeVisible({ timeout: 15_000 });

      const decryptField = page.getByTestId('passphrase-input-field');
      await decryptField.fill(passphrase);
      await page.getByTestId('share-decrypt-button').click();

      await expect(page.getByTestId('share-decrypt-plaintext')).toContainText(plaintext, {
        timeout: 15_000,
      });

      await page.getByTestId('share-decrypt-burn').click();
      await expect(page.getByTestId('share-decrypt-burned')).toBeVisible();
      await expect(page.getByText('Local plaintext removed from this device.')).toBeVisible();
      await expect(
        page.getByText(
          'This does not delete the channel or mark it expired. Re-enter your passphrase to decrypt again.'
        )
      ).toBeVisible();
      await expect(page.getByTestId('share-step-delivered')).toBeVisible();
      await expect(page.getByTestId('share-decrypt-plaintext')).toHaveCount(0);
      await expect(decryptField).toHaveValue('');

      await decryptField.fill(passphrase);
      await page.getByTestId('share-decrypt-button').click();
      await expect(page.getByTestId('share-decrypt-plaintext')).toContainText(plaintext, {
        timeout: 15_000,
      });
    } finally {
      await authenticator.teardown();
    }
  });
});
