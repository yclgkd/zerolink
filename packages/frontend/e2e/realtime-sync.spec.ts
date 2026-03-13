import { expect, test } from '@playwright/test';

import { type ChannelMap, installStatefulApiMock } from './support/mock-api';
import { installVirtualAuthenticator } from './support/webauthn';

test.describe('Real-time sync via polling fallback', () => {
  test('Sender ManagePage auto-updates when receiver locks (polling fallback)', async ({
    browser,
  }) => {
    // Shared state between sender and receiver pages
    const channels: ChannelMap = new Map();

    const senderContext = await browser.newContext();
    const receiverContext = await browser.newContext();
    const senderPage = await senderContext.newPage();
    const receiverPage = await receiverContext.newPage();

    await installStatefulApiMock(senderPage, channels);
    await installStatefulApiMock(receiverPage, channels);
    const senderAuth = await installVirtualAuthenticator(senderPage);
    const receiverAuth = await installVirtualAuthenticator(receiverPage);

    try {
      // ── Step 1: Create channel on sender page ──────────────────────────

      await senderPage.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(senderPage.getByTestId('page-create')).toBeVisible({ timeout: 15_000 });

      // Use Quick Share (password mode) to avoid WebAuthn complexity
      await expect(senderPage.getByTestId('mode-card-quick')).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 15_000 }
      );
      await senderPage.getByTestId('passphrase-input-field').fill('SenderQuickPass#123');
      await expect(senderPage.getByTestId('create-submit-button')).toBeEnabled({
        timeout: 15_000,
      });
      await senderPage.getByTestId('create-submit-button').click();

      const shareLinkLocator = senderPage.getByTestId('create-success-share-link');
      const manageLinkLocator = senderPage.getByTestId('create-success-manage-link');
      await expect(shareLinkLocator).toBeVisible({ timeout: 15_000 });
      await expect(manageLinkLocator).toBeVisible({ timeout: 15_000 });

      const shareUrl = await shareLinkLocator.getAttribute('href');
      const manageUrl = await manageLinkLocator.getAttribute('href');
      if (!shareUrl || !manageUrl) throw new Error('Missing share or manage URL');

      // ── Step 2: Sender opens ManagePage — should show WAITING ──────────

      await senderPage.goto(manageUrl, { waitUntil: 'domcontentloaded' });
      await expect(senderPage.getByTestId('page-manage')).toBeVisible({ timeout: 15_000 });
      await expect(senderPage.getByTestId('manage-state-waiting')).toBeVisible({ timeout: 15_000 });
      await expect(senderPage.getByTestId('manage-share-link-card')).toHaveCount(0);
      await expect(senderPage.getByTestId('manage-copy-button')).toHaveCount(0);

      // ── Step 3: Receiver opens SharePage and locks ─────────────────────

      await receiverPage.goto(shareUrl, { waitUntil: 'domcontentloaded' });
      await expect(receiverPage.getByTestId('share-step-onboarding')).toBeVisible({
        timeout: 15_000,
      });
      await receiverPage.getByTestId('share-continue-button').click();

      await expect(receiverPage.getByTestId('share-step-lock')).toBeVisible();
      await receiverPage.getByTestId('passphrase-input-field').fill('TestPass123!');
      await receiverPage.getByTestId('share-generate-button').click();

      await expect(receiverPage.getByTestId('share-step-locked')).toBeVisible({ timeout: 15_000 });

      // ── Step 4: Sender's ManagePage should auto-update to LOCKED ───────
      // The WS connection will fail (no real WS server in mock env),
      // so the app degrades to polling /api/public/:uuid every ~18s.
      // We wait up to 30s for the poll to pick up the LOCKED state.

      await expect(senderPage.getByTestId('manage-state-locked')).toBeVisible({ timeout: 30_000 });
    } finally {
      await senderAuth.teardown();
      await receiverAuth.teardown();
      await senderContext.close();
      await receiverContext.close();
    }
  });

  test('Receiver SharePage auto-updates when sender delivers (polling fallback)', async ({
    browser,
  }) => {
    const channels: ChannelMap = new Map();

    const senderContext = await browser.newContext();
    const receiverContext = await browser.newContext();
    const senderPage = await senderContext.newPage();
    const receiverPage = await receiverContext.newPage();

    await installStatefulApiMock(senderPage, channels);
    await installStatefulApiMock(receiverPage, channels);
    const senderAuth = await installVirtualAuthenticator(senderPage);
    const receiverAuth = await installVirtualAuthenticator(receiverPage);

    const passphrase = 'CorrectHorseBatteryStaple!123';
    const plaintext = 'Auto-sync test secret';

    try {
      // ── Step 1: Create channel ─────────────────────────────────────────

      await senderPage.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(senderPage.getByTestId('page-create')).toBeVisible({ timeout: 15_000 });

      // Use Secure profile (WebAuthn)
      await senderPage.getByTestId('mode-card-secure').click();
      await expect(senderPage.getByTestId('mode-card-secure')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(senderPage.getByTestId('create-submit-button')).toBeEnabled({
        timeout: 15_000,
      });
      await senderPage.getByTestId('create-submit-button').click();

      const shareLinkLocator = senderPage.getByTestId('create-success-share-link');
      const manageLinkLocator = senderPage.getByTestId('create-success-manage-link');
      await expect(shareLinkLocator).toBeVisible({ timeout: 15_000 });

      const shareUrl = await shareLinkLocator.getAttribute('href');
      const manageUrl = await manageLinkLocator.getAttribute('href');

      // ── Step 2: Receiver locks ─────────────────────────────────────────
      if (!shareUrl || !manageUrl) throw new Error('Missing share or manage URL');

      await receiverPage.goto(shareUrl, { waitUntil: 'domcontentloaded' });
      await expect(receiverPage.getByTestId('share-step-onboarding')).toBeVisible({
        timeout: 15_000,
      });
      await receiverPage.getByTestId('share-continue-button').click();
      await receiverPage.getByTestId('passphrase-input-field').fill(passphrase);
      await receiverPage.getByTestId('share-generate-button').click();
      await expect(receiverPage.getByTestId('share-step-locked')).toBeVisible({ timeout: 15_000 });

      // ── Step 3: Sender delivers ────────────────────────────────────────

      await senderPage.goto(manageUrl, { waitUntil: 'domcontentloaded' });
      await expect(senderPage.getByTestId('page-manage')).toBeVisible({ timeout: 15_000 });
      // Wait for LOCKED state (initial fetch or poll)
      await expect(senderPage.getByTestId('manage-state-locked')).toBeVisible({ timeout: 30_000 });

      await senderPage.getByTestId('manage-secret-input').fill(plaintext);
      await senderPage.getByTestId('manage-deliver-button').click();
      await expect(senderPage.getByTestId('manage-state-delivered')).toBeVisible({
        timeout: 15_000,
      });

      // ── Step 4: Receiver's SharePage should auto-update to DELIVERED ───
      // Receiver is still on the locked step; polling should pick up DELIVERED.

      await expect(receiverPage.getByTestId('share-step-delivered')).toBeVisible({
        timeout: 30_000,
      });
      await expect(receiverPage.getByTestId('safety-code-root')).toBeVisible({ timeout: 15_000 });
      await expect(receiverPage.getByTestId('share-decrypt-panel')).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await senderAuth.teardown();
      await receiverAuth.teardown();
      await senderContext.close();
      await receiverContext.close();
    }
  });

  test('Receiver SharePage on a different device does not expose Safety Code or decrypt controls', async ({
    browser,
  }) => {
    const channels: ChannelMap = new Map();

    const senderContext = await browser.newContext();
    const receiverOwnerContext = await browser.newContext();
    const receiverOtherContext = await browser.newContext();
    const senderPage = await senderContext.newPage();
    const receiverOwnerPage = await receiverOwnerContext.newPage();
    const receiverOtherPage = await receiverOtherContext.newPage();

    await installStatefulApiMock(senderPage, channels);
    await installStatefulApiMock(receiverOwnerPage, channels);
    await installStatefulApiMock(receiverOtherPage, channels);
    const senderAuth = await installVirtualAuthenticator(senderPage);

    const passphrase = 'CorrectHorseBatteryStaple!123';
    const plaintext = 'Cross-device receiver guard secret';

    try {
      await senderPage.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(senderPage.getByTestId('page-create')).toBeVisible({ timeout: 15_000 });
      await senderPage.getByTestId('mode-card-secure').click();
      await expect(senderPage.getByTestId('mode-card-secure')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(senderPage.getByTestId('create-submit-button')).toBeEnabled({
        timeout: 15_000,
      });
      await senderPage.getByTestId('create-submit-button').click();

      const shareUrl = await senderPage
        .getByTestId('create-success-share-link')
        .getAttribute('href');
      const manageUrl = await senderPage
        .getByTestId('create-success-manage-link')
        .getAttribute('href');

      if (!shareUrl || !manageUrl) throw new Error('Missing share or manage URL');

      await receiverOwnerPage.goto(shareUrl, { waitUntil: 'domcontentloaded' });
      await expect(receiverOwnerPage.getByTestId('share-step-onboarding')).toBeVisible({
        timeout: 15_000,
      });
      await receiverOwnerPage.getByTestId('share-continue-button').click();
      await receiverOwnerPage.getByTestId('passphrase-input-field').fill(passphrase);
      await receiverOwnerPage.getByTestId('share-generate-button').click();
      await expect(receiverOwnerPage.getByTestId('share-step-locked')).toBeVisible({
        timeout: 15_000,
      });
      await expect(receiverOwnerPage.getByTestId('safety-code-root')).toBeVisible({
        timeout: 15_000,
      });

      await receiverOtherPage.goto(shareUrl, { waitUntil: 'domcontentloaded' });
      await expect(receiverOtherPage.getByTestId('share-step-locked')).toBeVisible({
        timeout: 15_000,
      });
      await expect(receiverOtherPage.getByTestId('share-safety-unavailable')).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        receiverOtherPage.getByText('This device cannot verify the Safety Code.')
      ).toBeVisible({ timeout: 15_000 });
      await expect(receiverOtherPage.getByTestId('safety-code-root')).toHaveCount(0);

      await senderPage.goto(manageUrl, { waitUntil: 'domcontentloaded' });
      await expect(senderPage.getByTestId('manage-state-locked')).toBeVisible({ timeout: 30_000 });
      await senderPage.getByTestId('manage-secret-input').fill(plaintext);
      await senderPage.getByTestId('manage-deliver-button').click();
      await expect(senderPage.getByTestId('manage-state-delivered')).toBeVisible({
        timeout: 15_000,
      });

      await expect(receiverOwnerPage.getByTestId('share-step-delivered')).toBeVisible({
        timeout: 30_000,
      });
      await expect(receiverOwnerPage.getByTestId('safety-code-root')).toBeVisible({
        timeout: 15_000,
      });
      await expect(receiverOwnerPage.getByTestId('share-decrypt-panel')).toBeVisible({
        timeout: 15_000,
      });

      await expect(receiverOtherPage.getByTestId('share-step-delivered')).toBeVisible({
        timeout: 30_000,
      });
      await expect(receiverOtherPage.getByTestId('share-decrypt-panel')).toHaveCount(0);
      await expect(receiverOtherPage.getByTestId('share-decrypt-unavailable')).toBeVisible({
        timeout: 15_000,
      });
      await expect(receiverOtherPage.getByText('Decrypt unavailable on this device.')).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await senderAuth.teardown();
      await senderContext.close();
      await receiverOwnerContext.close();
      await receiverOtherContext.close();
    }
  });
});
