import { expect, type Page, test } from '@playwright/test';

async function createQuickChannel(
  senderPage: Page
): Promise<{ manageUrl: string; shareUrl: string }> {
  await senderPage.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(senderPage.getByTestId('page-create')).toBeVisible();
  await expect(senderPage.getByTestId('mode-card-quick')).toHaveAttribute('aria-pressed', 'true');
  await senderPage.getByTestId('passphrase-input-field').fill('SmokeTestSender#2024');
  await expect(senderPage.getByTestId('create-submit-button')).toBeEnabled();
  await senderPage.getByTestId('create-submit-button').click();

  const shareLinkLocator = senderPage.getByTestId('create-success-share-link');
  const manageLinkLocator = senderPage.getByTestId('create-success-manage-link');
  await expect(shareLinkLocator).toBeVisible();
  await expect(manageLinkLocator).toBeVisible();

  const shareUrl = (await shareLinkLocator.textContent())?.trim() ?? null;
  const manageUrl = await manageLinkLocator.getAttribute('href');
  if (!shareUrl || !manageUrl) {
    throw new Error('Missing share or manage URL');
  }

  return { manageUrl, shareUrl };
}

async function lockQuickChannel(
  receiverPage: Page,
  shareUrl: string,
  passphrase: string
): Promise<void> {
  await receiverPage.goto(shareUrl, { waitUntil: 'domcontentloaded' });
  await expect(receiverPage.getByTestId('share-step-onboarding')).toBeVisible();
  await receiverPage.getByTestId('share-continue-button').click();
  await expect(receiverPage.getByTestId('share-step-lock')).toBeVisible();
  await receiverPage.getByTestId('passphrase-input-field').fill(passphrase);
  await receiverPage.getByTestId('share-generate-button').click();
  await expect(receiverPage.getByTestId('share-step-locked')).toBeVisible();
}

test.describe('Staging smoke: Create → Lock → Deliver → Decrypt', () => {
  test('core quick-mode flow against real staging', async ({ browser }) => {
    const senderContext = await browser.newContext();
    const receiverContext = await browser.newContext();
    const senderPage = await senderContext.newPage();
    const receiverPage = await receiverContext.newPage();

    try {
      const { manageUrl, shareUrl } = await createQuickChannel(senderPage);

      await lockQuickChannel(receiverPage, shareUrl, 'SmokeTestReceiver#2024');

      await senderPage.goto(manageUrl, { waitUntil: 'domcontentloaded' });
      await expect(senderPage.getByTestId('page-manage')).toBeVisible();
      await expect(senderPage.getByTestId('manage-state-locked')).toBeVisible();

      await senderPage.getByTestId('manage-secret-input').fill('Staging smoke test secret');
      await senderPage.getByTestId('passphrase-input-field').fill('SmokeTestSender#2024');
      await senderPage.getByTestId('manage-deliver-button').click();
      await expect(senderPage.getByTestId('manage-state-delivered')).toBeVisible();

      await receiverPage.goto(shareUrl, { waitUntil: 'domcontentloaded' });
      await expect(receiverPage.getByTestId('share-step-delivered')).toBeVisible();
      await expect(receiverPage.getByTestId('share-decrypt-panel')).toBeVisible();
      await receiverPage.getByTestId('passphrase-input-field').fill('SmokeTestReceiver#2024');
      await receiverPage.getByTestId('share-decrypt-button').click();
      await expect(receiverPage.getByTestId('share-decrypt-plaintext')).toContainText(
        'Staging smoke test secret'
      );
    } finally {
      await senderContext.close();
      await receiverContext.close();
    }
  });
});
