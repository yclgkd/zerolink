// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lockChannelMock, decryptDeliveredMock, toastSuccessMock } = vi.hoisted(() => ({
  lockChannelMock: vi.fn(),
  decryptDeliveredMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('../crypto/orchestrator', async () => ({
  cryptoOrchestrator: {
    lockChannel: lockChannelMock,
    decryptDelivered: decryptDeliveredMock,
  },
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock },
  Toaster: () => null,
}));

vi.mock('../sync/use-channel-sync.ts', async () => ({
  useChannelSync: () => ({ connectionMode: 'offline' as const }),
}));

import { useDecryptStore } from '../stores/decrypt-store';
import { useLockStore } from '../stores/lock-store';
import {
  clearReceiverKeyStorage,
  createDeferred,
  getFetchSpy,
  MOCK_TIMESTAMP,
  mockDecryptFileSuccessWithStoreSideEffects,
  mockDecryptSuccessWithStoreSideEffects,
  mockLockSuccessWithStoreSideEffects,
  mockPublicState,
  renderSharePage,
  saveReceiverEnvelopesForDeliveredTests,
  VALID_HEX,
  VALID_UUID,
  waitForDeliveredDecryptPanel,
} from './helpers/share-page-decrypt-test-helpers';

const originalFetch = globalThis.fetch;
let replaceStateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await clearReceiverKeyStorage();
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  window.sessionStorage.clear();
  replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
  useLockStore.getState().resetLockStore();
  useDecryptStore.getState().resetDecryptStore();
  vi.clearAllMocks();
  mockLockSuccessWithStoreSideEffects(lockChannelMock);
  mockDecryptSuccessWithStoreSideEffects(decryptDeliveredMock);
});

afterEach(async () => {
  cleanup();
  await clearReceiverKeyStorage();
  window.sessionStorage.clear();
  replaceStateSpy.mockRestore();

  if (originalFetch) {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  } else {
    Reflect.deleteProperty(globalThis, 'fetch');
  }
});

describe('SharePage – decryptDelivered interactions', () => {
  it('calls decryptDelivered with uuid/passphrase and shows plaintext on success', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await waitFor(() => {
      expect(decryptDeliveredMock).toHaveBeenCalledTimes(1);
    });

    const callArg = decryptDeliveredMock.mock.calls[0]?.[0];
    expect(callArg?.uuid).toBe(VALID_UUID);
    expect(callArg?.passphrase).toBe('Receiver#Pass1234');
    expect(await screen.findByTestId('share-decrypt-plaintext')).toBeTruthy();
    expect((screen.getByTestId('passphrase-input-field') as HTMLInputElement).value).toBe('');
  });

  it('disables decrypt and burn buttons while decrypt is pending, then restores controls', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    const deferred = createDeferred<{
      ok: true;
      data: {
        plaintext: string;
        deliveredAt: number;
        receiverPubFpr: string;
        cipherVersion: number;
      };
    }>();
    decryptDeliveredMock.mockReturnValueOnce(deferred.promise);

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await waitFor(() => {
      expect((screen.getByTestId('share-decrypt-button') as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId('share-decrypt-burn') as HTMLButtonElement).disabled).toBe(true);
    });

    deferred.resolve({
      ok: true,
      data: {
        plaintext: 'decrypted:Receiver#Pass1234',
        deliveredAt: MOCK_TIMESTAMP,
        receiverPubFpr: VALID_HEX,
        cipherVersion: 0,
      },
    });

    await waitFor(() => {
      const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
      expect(decryptButton.disabled).toBe(true);
      expect(decryptButton.textContent).toBe('Decrypt');
      expect((screen.getByTestId('passphrase-input-field') as HTMLInputElement).value).toBe('');
    });
  });

  it('keeps decrypt pending during re-decrypt when plaintext already exists', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'first-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));
    expect(await screen.findByTestId('share-decrypt-plaintext')).toBeTruthy();

    const deferred = createDeferred<{
      ok: true;
      data: {
        plaintext: string;
        deliveredAt: number;
        receiverPubFpr: string;
        cipherVersion: number;
      };
    }>();
    decryptDeliveredMock.mockReturnValueOnce(deferred.promise);

    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'second-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await waitFor(() => {
      const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
      const burnButton = screen.getByTestId('share-decrypt-burn') as HTMLButtonElement;
      expect(decryptButton.disabled).toBe(true);
      expect(decryptButton.textContent).toBe('Decrypting…');
      expect(burnButton.disabled).toBe(true);
    });

    deferred.resolve({
      ok: true,
      data: {
        plaintext: 'decrypted:second-passphrase',
        deliveredAt: MOCK_TIMESTAMP,
        receiverPubFpr: VALID_HEX,
        cipherVersion: 0,
      },
    });
  });

  it('shows decrypt error on decrypt failure without crashing delivered view', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    decryptDeliveredMock.mockResolvedValueOnce({
      ok: false,
      error: {
        ok: false,
        code: 'KEY_STORAGE_ERROR',
        stage: 'decrypt.load-key',
      },
    });

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    const error = await screen.findByTestId('share-decrypt-error');
    expect(error).toBeTruthy();
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.getAttribute('aria-live')).toBe('assertive');
    expect(
      (screen.getByTestId('passphrase-input-field') as HTMLInputElement).getAttribute(
        'aria-invalid'
      )
    ).toBeNull();
    expect(
      (screen.getByTestId('passphrase-input-field') as HTMLInputElement).getAttribute(
        'aria-describedby'
      )
    ).toBeNull();
    expect(screen.getByText('Local key material is unavailable on this device.')).toBeTruthy();
    expect(screen.getByTestId('share-step-delivered')).toBeTruthy();
  });

  it('marks decrypt passphrase invalid for CRYPTO_ERROR', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    decryptDeliveredMock.mockResolvedValueOnce({
      ok: false,
      error: {
        ok: false,
        code: 'CRYPTO_ERROR',
        stage: 'decrypt.crypto',
      },
    });

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    const error = await screen.findByTestId('share-decrypt-error');
    expect(error).toBeTruthy();
    expect(
      (screen.getByTestId('passphrase-input-field') as HTMLInputElement).getAttribute(
        'aria-invalid'
      )
    ).toBe('true');
    expect(
      (screen.getByTestId('passphrase-input-field') as HTMLInputElement).getAttribute(
        'aria-describedby'
      )
    ).toBe('share-decrypt-error');
    expect(screen.getByText('Unable to decrypt with the provided passphrase.')).toBeTruthy();
  });

  it('maps integrity mismatch to user-friendly decrypt error message', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    decryptDeliveredMock.mockResolvedValueOnce({
      ok: false,
      error: {
        ok: false,
        code: 'INTEGRITY_MISMATCH',
        stage: 'decrypt.verify',
      },
    });

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    expect(await screen.findByTestId('share-decrypt-error')).toBeTruthy();
    expect(screen.getByText('Ciphertext integrity verification failed.')).toBeTruthy();
  });

  it('burns local plaintext, shows local-only notice, and clears passphrase', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    expect(await screen.findByTestId('share-decrypt-plaintext')).toBeTruthy();

    fireEvent.click(screen.getByTestId('share-decrypt-burn'));

    expect(screen.queryByTestId('share-decrypt-plaintext')).toBeNull();
    const burned = screen.getByTestId('share-decrypt-burned');
    expect(burned).toBeTruthy();
    expect(burned.getAttribute('role')).toBe('status');
    expect(burned.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('Local decrypted copy removed from this device.')).toBeTruthy();
    expect(
      screen.getByText(
        'This does not delete the channel or mark it expired. Re-enter your passphrase to decrypt again.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Channel Delivered')).toBeTruthy();
    expect((screen.getByTestId('passphrase-input-field') as HTMLInputElement).value).toBe('');
  });

  it('allows re-decrypt after burn with a new passphrase input', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'first-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));
    expect(await screen.findByTestId('share-decrypt-plaintext')).toBeTruthy();

    fireEvent.click(screen.getByTestId('share-decrypt-burn'));
    expect(screen.getByTestId('share-decrypt-burned')).toBeTruthy();

    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'second-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await waitFor(() => {
      expect(decryptDeliveredMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId('share-decrypt-burned')).toBeNull();
    expect(await screen.findByTestId('share-decrypt-plaintext')).toBeTruthy();
  });

  it('shows decrypted file metadata and downloads only after explicit click', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');
    mockDecryptFileSuccessWithStoreSideEffects(decryptDeliveredMock);

    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-file');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    expect(await screen.findByTestId('share-decrypt-file')).toBeTruthy();
    expect(screen.queryByTestId('share-decrypt-plaintext')).toBeNull();
    expect(createObjectURLSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('share-download-file-button'));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-file');
    });
  });

  it('shows delivery timestamp after successful decrypt', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    const el = await screen.findByTestId('share-delivery-timestamp');
    // Prefix is fixed; year "2023" is present in any locale for MOCK_TIMESTAMP (Nov 2023)
    expect(el.textContent).toMatch(/^Delivered:/);
    expect(el.textContent).toContain('2023');
  });

  it('shows updated badge when cipherVersion is 1 or more', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');
    mockDecryptSuccessWithStoreSideEffects(decryptDeliveredMock, 1);

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    const badge = await screen.findByTestId('share-delivery-updated-badge');
    // cipherVersion=1 → user-facing v2 (0-based internal → 1-based display)
    expect(badge.textContent).toContain('Updated (v2)');
    // <output> has implicit role="status" semantics without a role attribute
    expect(badge.tagName.toLowerCase()).toBe('output');
  });

  it('does not show updated badge when cipherVersion is 0 (first delivery)', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await screen.findByTestId('share-decrypt-plaintext');
    expect(screen.queryByTestId('share-delivery-updated-badge')).toBeNull();
  });

  it('shows cipher version notice before re-decrypt when cipherVersion >= 1 and plaintext is burned', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');
    mockDecryptSuccessWithStoreSideEffects(decryptDeliveredMock, 1);

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();

    // First decrypt returns cipherVersion=1
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));
    await screen.findByTestId('share-decrypt-plaintext');

    // No notice while plaintext is visible
    expect(screen.queryByTestId('share-cipher-version-notice')).toBeNull();

    // Burn plaintext
    fireEvent.click(screen.getByTestId('share-decrypt-burn'));
    await screen.findByTestId('share-decrypt-burned');

    // Notice appears before re-decrypt
    expect(screen.getByTestId('share-cipher-version-notice')).toBeTruthy();
    expect(screen.getByTestId('share-cipher-version-notice').textContent).toContain(
      'The content has been updated'
    );
  });

  it('does not show cipher version notice when cipherVersion is 0', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));
    await screen.findByTestId('share-decrypt-plaintext');

    fireEvent.click(screen.getByTestId('share-decrypt-burn'));
    await screen.findByTestId('share-decrypt-burned');

    expect(screen.queryByTestId('share-cipher-version-notice')).toBeNull();
  });

  it('calls toast.success after burn', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));
    await screen.findByTestId('share-decrypt-plaintext');

    fireEvent.click(screen.getByTestId('share-decrypt-burn'));

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledOnce();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Local decrypted copy removed.');
  });
});
