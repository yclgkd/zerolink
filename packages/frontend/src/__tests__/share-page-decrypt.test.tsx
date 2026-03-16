// @vitest-environment jsdom

import './helpers/i18n-test-setup';

import 'fake-indexeddb/auto';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Base64UrlSchema, HexStringSchema, SECURITY_PROFILE } from '@zerolink/shared';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lockChannelMock, decryptDeliveredMock, syncHarness } = vi.hoisted(() => ({
  lockChannelMock: vi.fn(),
  decryptDeliveredMock: vi.fn(),
  syncHarness: {
    latestOptions: null as {
      onStateChange: (update: {
        state: string;
        version: number;
        adminMode: string;
        securityProfile: string;
        receiverPubFpr?: string;
      }) => void;
      onChannelClosed: (reason: string) => void;
    } | null,
  },
}));

vi.mock('../crypto/orchestrator', async () => {
  return {
    cryptoOrchestrator: {
      lockChannel: lockChannelMock,
      decryptDelivered: decryptDeliveredMock,
    },
  };
});

vi.mock('../sync/use-channel-sync.ts', async () => {
  return {
    useChannelSync: (
      uuid: string | undefined,
      options: {
        onStateChange: (update: {
          state: string;
          version: number;
          adminMode: string;
          securityProfile: string;
          receiverPubFpr?: string;
        }) => void;
        onChannelClosed: (reason: string) => void;
      }
    ) => {
      syncHarness.latestOptions = uuid ? options : null;
      return { connectionMode: 'offline' as const };
    },
  };
});

import { createIndexedDbReceiverKeyStorage, type ReceiverKeyEnvelope } from '../crypto/storage';
import { SharePage } from '../pages/SharePage';
import { useDecryptStore } from '../stores/decrypt-store';
import { useLockStore } from '../stores/lock-store';

const originalFetch = globalThis.fetch;
const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const VALID_HEX = HexStringSchema.parse(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);
const VALID_B64U = Base64UrlSchema.parse('bW9ja19iYXNlNjR1cmw');
const MOCK_TIMESTAMP = 1_700_000_000_000;
const RECEIVER_STORAGE_UUIDS = [
  VALID_UUID,
  'uuidaaaaaaaaaaaaaaaaa',
  'uuidbbbbbbbbbbbbbbbbb',
] as const;

function getFetchSpy(): ReturnType<typeof vi.fn> {
  if (!vi.isMockFunction(globalThis.fetch)) {
    throw new Error('global fetch is not mocked');
  }

  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function renderSharePage(routePath = '/s/:uuid', initialPath = '/s/demo-channel-shell') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<SharePage />} path={routePath} />
      </Routes>
    </MemoryRouter>
  );
}

async function waitForDeliveredDecryptPanel() {
  expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
  return screen.findByTestId('share-decrypt-panel');
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function mockPublicState(
  fetchSpy: ReturnType<typeof vi.fn>,
  state: 'waiting' | 'locked' | 'delivered',
  options?: { receiverPubFpr?: string | null }
) {
  const receiverPubFpr =
    options && 'receiverPubFpr' in options
      ? options.receiverPubFpr
      : state === 'locked' || state === 'delivered'
        ? VALID_HEX
        : null;

  fetchSpy.mockResolvedValueOnce(
    jsonResponse({
      ok: true,
      state,
      adminMode: 'webauthn',
      securityProfile: SECURITY_PROFILE.SECURE,
      ...(receiverPubFpr ? { receiverPubFpr } : {}),
    })
  );
}

function createReceiverEnvelope(
  uuid: string = VALID_UUID,
  receiverPubFpr: string = VALID_HEX
): ReceiverKeyEnvelope {
  return {
    uuid,
    receiverPubFpr,
    wrappedPrivateKey: {
      encryptedKey: VALID_B64U,
      iv: VALID_B64U,
      kdf: {
        kdfType: 'argon2id',
        version: 19,
        m: 65_536,
        t: 3,
        p: 1,
        salt: VALID_B64U,
      },
    },
    updatedAt: MOCK_TIMESTAMP,
  };
}

async function saveReceiverEnvelope(
  uuid: string = VALID_UUID,
  receiverPubFpr: string = VALID_HEX
): Promise<void> {
  const receiverKeyStorage = createIndexedDbReceiverKeyStorage();
  await receiverKeyStorage.save(createReceiverEnvelope(uuid, receiverPubFpr));
}

async function saveReceiverEnvelopesForDeliveredTests(): Promise<void> {
  await Promise.all([
    saveReceiverEnvelope(VALID_UUID),
    saveReceiverEnvelope('uuidaaaaaaaaaaaaaaaaa'),
    saveReceiverEnvelope('uuidbbbbbbbbbbbbbbbbb'),
  ]);
}

async function clearReceiverKeyStorage(): Promise<void> {
  const receiverKeyStorage = createIndexedDbReceiverKeyStorage();
  const failures: string[] = [];

  await Promise.all(
    RECEIVER_STORAGE_UUIDS.map(async (uuid) => {
      try {
        await receiverKeyStorage.remove(uuid);
      } catch (error: unknown) {
        failures.push(`${uuid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  if (failures.length > 0) {
    throw new Error(
      `Failed to clear receiver key storage for test isolation:\n${failures.join('\n')}`
    );
  }
}

function mockLockSuccessWithStoreSideEffects(): void {
  lockChannelMock.mockImplementation(async () => {
    useLockStore.getState().setSafetyCode({
      emoji: {
        type: 'emoji',
        emojis: ['🔥', '🌲', '🚀', '🔮', '💎', '🎯', '⚡', '🌙'],
      },
      color: {
        type: 'color',
        cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      },
      shortFpr: 'a1b2c3d4e5f6...f1e2d3c4b5a6',
      fullFpr: VALID_HEX,
    });
    useLockStore.getState().markLocked();

    return {
      ok: true,
      data: {
        receiverPubJwk: {
          kty: 'RSA',
          alg: 'RSA-OAEP-256',
          n: VALID_B64U,
          e: 'AQAB',
          ext: true,
          key_ops: ['encrypt'],
        },
        receiverPubFpr: VALID_HEX,
      },
    };
  });
}

function mockDecryptSuccessWithStoreSideEffects(cipherVersion = 0): void {
  decryptDeliveredMock.mockImplementation(async ({ passphrase }: { passphrase: string }) => {
    const plaintext = `decrypted:${passphrase}`;
    useDecryptStore.getState().setPlaintext(plaintext);
    return {
      ok: true,
      data: {
        plaintext,
        deliveredAt: MOCK_TIMESTAMP,
        receiverPubFpr: VALID_HEX,
        cipherVersion,
      },
    };
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function getLatestChannelSyncOptions() {
  if (!syncHarness.latestOptions) {
    throw new Error('useChannelSync options were not captured');
  }

  return syncHarness.latestOptions;
}

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
  syncHarness.latestOptions = null;
  vi.clearAllMocks();
  mockLockSuccessWithStoreSideEffects();
  mockDecryptSuccessWithStoreSideEffects();
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

describe('SharePage – decryptDelivered action', () => {
  it('does not render safety code after a realtime delivered update if this device lacks the local receiver key', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();

    act(() => {
      getLatestChannelSyncOptions().onStateChange({
        state: 'delivered',
        version: 1,
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
        receiverPubFpr: VALID_HEX,
      });
    });

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(await screen.findByText('This device cannot verify the Safety Code.')).toBeTruthy();
    expect(screen.queryByTestId('share-decrypt-panel')).toBeNull();
    expect(screen.getByTestId('share-decrypt-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
  });

  it('renders safety code after a realtime delivered update when this device has the matching receiver key', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'waiting');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();

    act(() => {
      getLatestChannelSyncOptions().onStateChange({
        state: 'delivered',
        version: 1,
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
        receiverPubFpr: VALID_HEX,
      });
    });

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(await screen.findByTestId('safety-code-root')).toBeTruthy();
    expect(await waitForDeliveredDecryptPanel()).toBeTruthy();
    expect(screen.queryByTestId('share-safety-unavailable')).toBeNull();
  });

  it('keeps decrypt button disabled when passphrase is empty in delivered state', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
    expect(decryptButton.disabled).toBe(true);
  });

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
      expect((screen.getByTestId('share-decrypt-button') as HTMLButtonElement).disabled).toBe(
        false
      );
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
    expect(screen.getByText('Local plaintext removed from this device.')).toBeTruthy();
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
      target: { value: 'first-pass' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));
    expect(await screen.findByTestId('share-decrypt-plaintext')).toBeTruthy();

    fireEvent.click(screen.getByTestId('share-decrypt-burn'));
    expect(screen.getByTestId('share-decrypt-burned')).toBeTruthy();

    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'second-pass' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await waitFor(() => {
      expect(decryptDeliveredMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId('share-decrypt-burned')).toBeNull();
    expect(await screen.findByTestId('share-decrypt-plaintext')).toBeTruthy();
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
    mockDecryptSuccessWithStoreSideEffects(1);

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
});
