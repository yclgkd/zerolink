import { expect, type Page, test } from '@playwright/test';

function normalizeRuntimeUrl(page: Page, rawUrl: string): string {
  // Wrangler local rewrites the worker-side origin to the configured route host,
  // so create_finish emits zerolink.dev URLs even though Playwright drives 127.0.0.1.
  const runtimeOrigin = new URL(page.url()).origin;
  const normalized = new URL(rawUrl, runtimeOrigin);
  const runtimeBase = new URL(runtimeOrigin);
  normalized.protocol = runtimeBase.protocol;
  normalized.host = runtimeBase.host;
  return normalized.toString();
}

async function createQuickChannel(
  senderPage: Page
): Promise<{ manageUrl: string; shareUrl: string }> {
  await senderPage.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(senderPage.getByTestId('page-create')).toBeVisible({ timeout: 15_000 });
  await expect(senderPage.getByTestId('mode-card-quick')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 15_000,
  });
  await senderPage.getByTestId('passphrase-input-field').fill('SenderQuickPass#123');
  await expect(senderPage.getByTestId('create-submit-button')).toBeEnabled({ timeout: 15_000 });
  await senderPage.getByTestId('create-submit-button').click();

  const shareLinkLocator = senderPage.getByTestId('create-success-share-link');
  const manageLinkLocator = senderPage.getByTestId('create-success-manage-link');
  await expect(shareLinkLocator).toBeVisible({ timeout: 15_000 });
  await expect(manageLinkLocator).toBeVisible({ timeout: 15_000 });

  const shareUrl = (await shareLinkLocator.textContent())?.trim() ?? null;
  const manageUrl = await manageLinkLocator.getAttribute('href');
  if (!shareUrl || !manageUrl) {
    throw new Error('Missing share or manage URL');
  }

  return {
    manageUrl: normalizeRuntimeUrl(senderPage, manageUrl),
    shareUrl: normalizeRuntimeUrl(senderPage, shareUrl),
  };
}

async function lockQuickChannel(
  receiverPage: Page,
  shareUrl: string,
  passphrase: string
): Promise<void> {
  await receiverPage.goto(shareUrl, { waitUntil: 'domcontentloaded' });
  await expect(receiverPage.getByTestId('share-step-onboarding')).toBeVisible({
    timeout: 15_000,
  });
  await receiverPage.getByTestId('share-continue-button').click();
  await expect(receiverPage.getByTestId('share-step-lock')).toBeVisible({ timeout: 15_000 });
  await receiverPage.getByTestId('passphrase-input-field').fill(passphrase);
  await receiverPage.getByTestId('share-generate-button').click();
  await expect(receiverPage.getByTestId('share-step-locked')).toBeVisible({ timeout: 15_000 });
}

test.describe('Real-time sync via WebSocket', () => {
  test('sender manage page auto-updates when receiver locks', async ({ browser }) => {
    const senderContext = await browser.newContext();
    const receiverContext = await browser.newContext();
    const senderPage = await senderContext.newPage();
    const receiverPage = await receiverContext.newPage();

    try {
      const { manageUrl, shareUrl } = await createQuickChannel(senderPage);

      await senderPage.goto(manageUrl, { waitUntil: 'domcontentloaded' });
      await expect(senderPage.getByTestId('page-manage')).toBeVisible({ timeout: 15_000 });
      await expect(senderPage.getByTestId('manage-state-waiting')).toBeVisible({ timeout: 15_000 });

      await lockQuickChannel(receiverPage, shareUrl, 'ReceiverQuickPass#123');

      await expect(senderPage.getByTestId('manage-state-locked')).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await senderContext.close();
      await receiverContext.close();
    }
  });

  test('receiver share page auto-updates when sender delivers', async ({ browser }) => {
    const senderContext = await browser.newContext();
    const receiverContext = await browser.newContext();
    const senderPage = await senderContext.newPage();
    const receiverPage = await receiverContext.newPage();

    try {
      const { manageUrl, shareUrl } = await createQuickChannel(senderPage);

      await lockQuickChannel(receiverPage, shareUrl, 'ReceiverQuickPass#123');

      await senderPage.goto(manageUrl, { waitUntil: 'domcontentloaded' });
      await expect(senderPage.getByTestId('page-manage')).toBeVisible({ timeout: 15_000 });
      await expect(senderPage.getByTestId('manage-state-locked')).toBeVisible({ timeout: 10_000 });

      await senderPage.getByTestId('manage-secret-input').fill('Real-time WebSocket secret');
      await senderPage.getByTestId('passphrase-input-field').fill('SenderQuickPass#123');
      await senderPage.getByTestId('manage-deliver-button').click();
      await expect(senderPage.getByTestId('manage-state-delivered')).toBeVisible({
        timeout: 15_000,
      });

      await expect(receiverPage.getByTestId('share-step-delivered')).toBeVisible({
        timeout: 10_000,
      });
      await expect(receiverPage.getByTestId('share-decrypt-panel')).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await senderContext.close();
      await receiverContext.close();
    }
  });
});
