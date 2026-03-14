// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Base64UrlSchema, HexStringSchema, SECURITY_PROFILE } from '@zerolink/shared';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
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

import * as storageModule from '../crypto/storage';
import {
  createIndexedDbReceiverKeyStorage,
  type ReceiverKeyEnvelope,
  type ReceiverKeyStorage,
} from '../crypto/storage';
import { SharePage } from '../pages/SharePage';
import { useDecryptStore } from '../stores/decrypt-store';
import { useLockStore } from '../stores/lock-store';

const originalFetch = globalThis.fetch;
const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const VALID_HEX = HexStringSchema.parse(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);
const OTHER_VALID_HEX = HexStringSchema.parse(
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
);
const VALID_B64U = Base64UrlSchema.parse('bW9ja19iYXNlNjR1cmw');
const VALID_LOCK_SECRET = 'bW9ja19sb2NrX3NlY3JldA';
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

async function waitForSafetyUnavailableTitle(title: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('share-safety-unavailable').textContent).toContain(title);
  });
}

async function waitForDecryptUnavailableTitle(title: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('share-decrypt-unavailable').textContent).toContain(title);
  });
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

function createMockReceiverKeyStorage(
  overrides: Partial<ReceiverKeyStorage> = {}
): ReceiverKeyStorage {
  return {
    load: overrides.load ?? (() => Promise.resolve(null)),
    save: overrides.save ?? (() => Promise.resolve()),
    remove: overrides.remove ?? (() => Promise.resolve()),
  };
}

function mockLegacyTerminalPublicState(
  fetchSpy: ReturnType<typeof vi.fn>,
  state: 'deleted' | 'expired'
) {
  fetchSpy.mockResolvedValueOnce(
    jsonResponse({
      ok: true,
      state,
      adminMode: 'webauthn',
      securityProfile: SECURITY_PROFILE.SECURE,
    })
  );
}

function mockPublicNotFound(fetchSpy: ReturnType<typeof vi.fn>) {
  fetchSpy.mockResolvedValueOnce(
    jsonResponse(
      {
        ok: false,
        code: 'NOT_FOUND',
      },
      404
    )
  );
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

function mockDecryptSuccessWithStoreSideEffects(): void {
  decryptDeliveredMock.mockImplementation(async ({ passphrase }: { passphrase: string }) => {
    const plaintext = `decrypted:${passphrase}`;
    useDecryptStore.getState().setPlaintext(plaintext);
    return {
      ok: true,
      data: {
        plaintext,
        plaintextBytes: new Uint8Array([1, 2, 3]),
        deliveredAt: MOCK_TIMESTAMP,
        receiverPubFpr: VALID_HEX,
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

beforeEach(async () => {
  await clearReceiverKeyStorage();
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
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

describe('SharePage', () => {
  it('loads waiting state from /api/public/:uuid and renders onboarding by default', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(`/api/public/${VALID_UUID}`);
    });

    expect(screen.getByTestId('page-share')).toBeTruthy();
    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();
    expect(
      screen.getByText(
        'The sender already created this channel. Set your own passphrase here to generate your receiver key and lock the channel on this device.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('This page is only for the receiver using the shared link.')
    ).toBeTruthy();
    expect(screen.getByText('Your passphrase stays on this device')).toBeTruthy();
    expect(screen.getByTestId('share-continue-button').textContent).toContain(
      'Continue as receiver'
    );
    const content = screen.getByTestId('page-share').querySelector('[aria-busy]');
    expect(content?.getAttribute('aria-busy')).toBe('false');
  });

  it('moves from onboarding to lock form when continuing in waiting state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));

    expect(screen.getByTestId('share-step-lock')).toBeTruthy();
    expect(screen.getByText('Choose your passphrase')).toBeTruthy();
    expect(screen.getByLabelText('Your passphrase')).toBeTruthy();
    expect(screen.getByTestId('share-generate-button').textContent).toContain(
      'Generate My Key & Lock'
    );
  });

  it('keeps generate button disabled when passphrase is empty', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    const generateButton = screen.getByTestId('share-generate-button') as HTMLButtonElement;

    expect(generateButton.disabled).toBe(true);
  });

  it('blocks lock when lock secret is missing and does not call lockChannel', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });

    const warning = screen.getByTestId('share-lock-secret-warning');
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    expect(
      (screen.getByTestId('passphrase-input-field') as HTMLInputElement).getAttribute(
        'aria-describedby'
      )
    ).toBeNull();
    const generateButton = screen.getByTestId('share-generate-button') as HTMLButtonElement;
    expect(generateButton.disabled).toBe(true);

    fireEvent.click(generateButton);
    await waitFor(() => {
      expect(lockChannelMock).not.toHaveBeenCalled();
    });
  });

  it('calls lockChannel with uuid, lockSecretB64u and passphrase when inputs are valid', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    fireEvent.click(screen.getByTestId('share-generate-button'));

    await waitFor(() => {
      expect(lockChannelMock).toHaveBeenCalledTimes(1);
    });

    const callArg = lockChannelMock.mock.calls[0]?.[0];
    expect(callArg?.uuid).toBe(VALID_UUID);
    expect(callArg?.lockSecretB64u).toBe(VALID_LOCK_SECRET);
    expect(callArg?.passphrase).toBe('Strong#Pass1234XYZ');
  });

  it('disables back/generate while lock request is pending then restores controls', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    const deferred = createDeferred<{
      ok: true;
      data: {
        receiverPubJwk: {
          kty: 'RSA';
          alg: 'RSA-OAEP-256';
          n: string;
          e: string;
          ext: true;
          key_ops: ['encrypt'];
        };
        receiverPubFpr: string;
      };
    }>();
    lockChannelMock.mockReturnValueOnce(deferred.promise);

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });

    fireEvent.click(screen.getByTestId('share-generate-button'));

    await waitFor(() => {
      expect((screen.getByTestId('share-generate-button') as HTMLButtonElement).disabled).toBe(
        true
      );
      expect((screen.getByTestId('share-back-button') as HTMLButtonElement).disabled).toBe(true);
    });
    const busyContainer = screen.getByTestId('page-share').querySelector('[aria-busy]');
    expect(busyContainer?.getAttribute('aria-busy')).toBe('true');

    deferred.resolve({
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
    });

    await waitFor(() => {
      expect((screen.getByTestId('share-generate-button') as HTMLButtonElement).disabled).toBe(
        false
      );
      expect((screen.getByTestId('share-back-button') as HTMLButtonElement).disabled).toBe(false);
    });
    expect(busyContainer?.getAttribute('aria-busy')).toBe('false');
  });

  it('renders locked state with real safety code after successful lock', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    fireEvent.click(screen.getByTestId('share-generate-button'));

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    expect(screen.getByTestId('safety-code-root')).toBeTruthy();
    expect(screen.queryByTestId('share-safety-unavailable')).toBeNull();
  });

  it('shows lock error and remains in lock form when lockChannel fails', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    lockChannelMock.mockResolvedValueOnce({
      ok: false,
      error: {
        ok: false,
        code: 'MISSING_LOCK_CHALLENGE',
        stage: 'lock.begin',
      },
    });

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    fireEvent.click(screen.getByTestId('share-generate-button'));

    expect(await screen.findByTestId('share-step-lock')).toBeTruthy();
    const error = await screen.findByTestId('share-lock-error');
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
    expect(screen.queryByTestId('share-step-locked')).toBeNull();
  });

  it('marks lock passphrase invalid when lockChannel reports PASSPHRASE_REQUIRED', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    lockChannelMock.mockResolvedValueOnce({
      ok: false,
      error: {
        ok: false,
        code: 'PASSPHRASE_REQUIRED',
        stage: 'lock.validate',
      },
    });

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    fireEvent.click(screen.getByTestId('share-generate-button'));

    const error = await screen.findByTestId('share-lock-error');
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
    ).toBe('share-lock-error');
  });

  it('renders safety code when locked state matches this device receiver key after refresh', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelope();
    mockPublicState(fetchSpy, 'locked');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    expect(screen.getByText('Receiver channel is locked')).toBeTruthy();
    expect(
      screen.getByText(
        'This receiver channel is locked. This page updates automatically, but only the device that created the lock can verify the Safety Code shown below.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Coordinate with the sender over another channel.')).toBeTruthy();
    expect(
      screen.getByText('Only confirm the Safety Code if this device shows it below.')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This page updates automatically when the sender delivers the encrypted secret.'
      )
    ).toBeTruthy();
    expect(await screen.findByTestId('safety-code-root')).toBeTruthy();
    expect(screen.queryByTestId('share-safety-unavailable')).toBeNull();
  });

  it('shows a security warning when locked state is present but this device has no receiver key', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    await waitFor(
      () => {
        expect(screen.getByTestId('share-safety-unavailable').textContent).toContain(
          'This device cannot verify the Safety Code.'
        );
      },
      { timeout: 5_000 }
    );
    const warning = screen.getByTestId('share-safety-unavailable');
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => {
      expect(warning.textContent).toContain(
        'No matching receiver key was found on this device. Do not confirm the Safety Code from here. If you expected to be the receiver, ask the sender to recreate the channel.'
      );
    });
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
  });

  it('shows a mismatch warning when local receiver identity does not match the locked channel', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelope(VALID_UUID, OTHER_VALID_HEX);
    mockPublicState(fetchSpy, 'locked');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    expect(await screen.findByText('Receiver identity mismatch detected.')).toBeTruthy();
    const warning = screen.getByTestId('share-safety-unavailable');
    expect(warning.getAttribute('role')).toBe('alert');
    expect(warning.getAttribute('aria-live')).toBe('assertive');
    expect(
      screen.getByText(
        'This device has different local receiver key material than the key currently locked on the channel. Treat this link as unsafe and ask the sender to recreate the channel.'
      )
    ).toBeTruthy();
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
  });

  it('shows the generic fallback when locked state is missing receiver fingerprint', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelope();
    mockPublicState(fetchSpy, 'locked', { receiverPubFpr: null });

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    await waitForSafetyUnavailableTitle('Safety Code unavailable right now.');
    const warning = screen.getByTestId('share-safety-unavailable');
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    expect(
      screen.getByText(
        'Receiver fingerprint is missing from the current channel state, so the Safety Code cannot be verified here.'
      )
    ).toBeTruthy();
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
  });

  it('renders delivered decrypt panel with locally verified safety code and does not fetch /api/decrypt_fetch directly', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await waitForDeliveredDecryptPanel()).toBeTruthy();
    expect(screen.getByText('Decrypt Delivered Secret')).toBeTruthy();
    expect(
      screen.getByText(
        'If this device created the receiver lock, enter that passphrase to decrypt the secret locally.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Channel Delivered')).toBeTruthy();
    expect(
      screen.getByText(
        'The encrypted secret has been delivered. Decryption still requires the device that created the receiver lock.'
      )
    ).toBeTruthy();
    expect(await screen.findByTestId('safety-code-root')).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(`/api/public/${VALID_UUID}`);
    expect(fetchSpy).not.toHaveBeenCalledWith(`/api/decrypt_fetch/${VALID_UUID}`);
  });

  it('keeps local decrypt available when delivered state is missing receiver fingerprint but this device has the receiver key', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered', { receiverPubFpr: null });

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await waitForDeliveredDecryptPanel()).toBeTruthy();
    await waitForSafetyUnavailableTitle('Safety Code unavailable right now.');
    expect(screen.getByText('Safety Code unavailable right now.')).toBeTruthy();
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
    expect(screen.queryByTestId('share-decrypt-unavailable')).toBeNull();
  });

  it('shows a security warning and blocks decrypt when delivered state has no local receiver key on this device', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(screen.queryByTestId('share-decrypt-panel')).toBeNull();
    expect(screen.getByTestId('share-decrypt-unavailable')).toBeTruthy();
    expect(await screen.findByText('This device cannot verify the Safety Code.')).toBeTruthy();
    await waitForDecryptUnavailableTitle('Decrypt unavailable on this device.');
    await waitFor(() => {
      expect(screen.getByTestId('share-decrypt-unavailable').textContent).toContain(
        'This device does not have the receiver key that locked the channel, so local decrypt is blocked here.'
      );
    });
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
  });

  it('blocks decrypt when delivered state receiver identity does not match this device', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelope(VALID_UUID, OTHER_VALID_HEX);
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(await screen.findByText('Receiver identity mismatch detected.')).toBeTruthy();
    expect(screen.queryByTestId('share-decrypt-panel')).toBeNull();
    expect(screen.getByTestId('share-decrypt-unavailable')).toBeTruthy();
    expect(screen.getByText('Decrypt blocked on this device.')).toBeTruthy();
    expect(
      screen.getByText(
        'The receiver key stored on this device does not match the key currently locked on the channel. Treat this link as unsafe and ask the sender to recreate the channel.'
      )
    ).toBeTruthy();
  });

  it('does not render safety code after a realtime locked update if this device lacks the local receiver key', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();

    act(() => {
      getLatestChannelSyncOptions().onStateChange({
        state: 'locked',
        version: 1,
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
        receiverPubFpr: VALID_HEX,
      });
    });

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    expect(await screen.findByText('This device cannot verify the Safety Code.')).toBeTruthy();
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
  });

  it('renders safety code after a realtime locked update when this device has the matching receiver key', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelope();
    mockPublicState(fetchSpy, 'waiting');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();

    act(() => {
      getLatestChannelSyncOptions().onStateChange({
        state: 'locked',
        version: 1,
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
        receiverPubFpr: VALID_HEX,
      });
    });

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    expect(await screen.findByTestId('safety-code-root')).toBeTruthy();
    expect(screen.queryByTestId('share-safety-unavailable')).toBeNull();
  });

  it('shows a storage-error warning when IndexedDB read fails in locked state', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi.spyOn(storageModule, 'createIndexedDbReceiverKeyStorage').mockReturnValue({
      load: () => Promise.reject(new Error('IndexedDB quota exceeded')),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    });

    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    expect(await screen.findByText('Unable to check the local receiver key.')).toBeTruthy();
    const warning = screen.getByTestId('share-safety-unavailable');
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    expect(
      screen.getByText(
        'ZeroLink could not read the receiver key material stored on this device, so the Safety Code cannot be verified here.'
      )
    ).toBeTruthy();
    expect(screen.queryByTestId('safety-code-root')).toBeNull();

    spy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('shows a storage-error warning and blocks decrypt when delivered state cannot read IndexedDB', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi.spyOn(storageModule, 'createIndexedDbReceiverKeyStorage').mockReturnValue({
      load: () => Promise.reject(new Error('IndexedDB quota exceeded')),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    });

    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(screen.queryByTestId('share-decrypt-panel')).toBeNull();
    expect(await screen.findByText('Unable to load the local receiver key.')).toBeTruthy();
    expect(screen.getByTestId('share-decrypt-unavailable')).toBeTruthy();
    expect(
      screen.getByText(
        'ZeroLink could not read the receiver key stored on this device, so local decrypt is unavailable here.'
      )
    ).toBeTruthy();

    spy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

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
        plaintextBytes: Uint8Array;
        deliveredAt: number;
        receiverPubFpr: string;
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
        plaintextBytes: new Uint8Array([1, 2, 3]),
        deliveredAt: MOCK_TIMESTAMP,
        receiverPubFpr: VALID_HEX,
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
        plaintextBytes: Uint8Array;
        deliveredAt: number;
        receiverPubFpr: string;
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
        plaintextBytes: new Uint8Array([1, 2, 3]),
        deliveredAt: MOCK_TIMESTAMP,
        receiverPubFpr: VALID_HEX,
      },
    });
  });

  it('resets decrypt pending when navigating to another delivered uuid mid-request', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
            securityProfile: SECURITY_PROFILE.SECURE,
          })
        );
      }
      if (url === '/api/public/uuidbbbbbbbbbbbbbbbbb') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
            securityProfile: SECURITY_PROFILE.SECURE,
          })
        );
      }

      return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
    });

    const deferred = createDeferred<{
      ok: true;
      data: {
        plaintext: string;
        plaintextBytes: Uint8Array;
        deliveredAt: number;
        receiverPubFpr: string;
      };
    }>();
    decryptDeliveredMock.mockReturnValueOnce(deferred.promise);

    const router = createMemoryRouter(
      [
        {
          path: '/s/:uuid',
          element: <SharePage />,
        },
      ],
      {
        initialEntries: ['/s/uuidaaaaaaaaaaaaaaaaa'],
      }
    );

    render(<RouterProvider router={router} />);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'first-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await waitFor(() => {
      const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
      expect(decryptButton.disabled).toBe(true);
      expect(decryptButton.textContent).toBe('Decrypting…');
    });

    await router.navigate('/s/uuidbbbbbbbbbbbbbbbbb');

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/public/uuidbbbbbbbbbbbbbbbbb');
    });
    expect(await waitForDeliveredDecryptPanel()).toBeTruthy();

    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'second-passphrase' },
    });

    await waitFor(() => {
      const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
      expect(decryptButton.disabled).toBe(false);
      expect(decryptButton.textContent).toBe('Decrypt');
    });

    deferred.resolve({
      ok: true,
      data: {
        plaintext: 'decrypted:first-passphrase',
        plaintextBytes: new Uint8Array([1, 2, 3]),
        deliveredAt: MOCK_TIMESTAMP,
        receiverPubFpr: VALID_HEX,
      },
    });
  });

  it('ignores stale decrypt failure after navigating to a new delivered uuid', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
            securityProfile: SECURITY_PROFILE.SECURE,
          })
        );
      }
      if (url === '/api/public/uuidbbbbbbbbbbbbbbbbb') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
            securityProfile: SECURITY_PROFILE.SECURE,
          })
        );
      }

      return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
    });

    const deferred = createDeferred<{
      ok: false;
      error: {
        ok: false;
        code: 'KEY_STORAGE_ERROR';
        stage: 'decrypt.load-key';
      };
    }>();
    decryptDeliveredMock.mockReturnValueOnce(deferred.promise);

    const router = createMemoryRouter(
      [
        {
          path: '/s/:uuid',
          element: <SharePage />,
        },
      ],
      {
        initialEntries: ['/s/uuidaaaaaaaaaaaaaaaaa'],
      }
    );

    render(<RouterProvider router={router} />);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'first-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await router.navigate('/s/uuidbbbbbbbbbbbbbbbbb');
    expect(await waitForDeliveredDecryptPanel()).toBeTruthy();
    expect(screen.queryByTestId('share-decrypt-error')).toBeNull();

    deferred.resolve({
      ok: false,
      error: {
        ok: false,
        code: 'KEY_STORAGE_ERROR',
        stage: 'decrypt.load-key',
      },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('share-decrypt-error')).toBeNull();
      expect(screen.getByTestId('share-step-delivered')).toBeTruthy();
    });
  });

  it('does not clear current pending when stale decrypt response resolves', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    const uuidBPublic = createDeferred<Response>();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
            securityProfile: SECURITY_PROFILE.SECURE,
          })
        );
      }
      if (url === '/api/public/uuidbbbbbbbbbbbbbbbbb') {
        return uuidBPublic.promise;
      }

      return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
    });

    const deferredA = createDeferred<{
      ok: true;
      data: {
        plaintext: string;
        plaintextBytes: Uint8Array;
        deliveredAt: number;
        receiverPubFpr: string;
      };
    }>();
    const deferredB = createDeferred<{
      ok: true;
      data: {
        plaintext: string;
        plaintextBytes: Uint8Array;
        deliveredAt: number;
        receiverPubFpr: string;
      };
    }>();

    decryptDeliveredMock
      .mockImplementationOnce(() => deferredA.promise)
      .mockImplementationOnce(() => deferredB.promise);

    const router = createMemoryRouter(
      [
        {
          path: '/s/:uuid',
          element: <SharePage />,
        },
      ],
      {
        initialEntries: ['/s/uuidaaaaaaaaaaaaaaaaa'],
      }
    );

    render(<RouterProvider router={router} />);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'first-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await router.navigate('/s/uuidbbbbbbbbbbbbbbbbb');
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/public/uuidbbbbbbbbbbbbbbbbb');
    });
    uuidBPublic.resolve(
      jsonResponse({
        ok: true,
        state: 'delivered',
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
      })
    );
    expect(await waitForDeliveredDecryptPanel()).toBeTruthy();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'second-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await waitFor(() => {
      expect(decryptDeliveredMock).toHaveBeenCalledTimes(2);
      const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
      expect(decryptButton.disabled).toBe(true);
      expect(decryptButton.textContent).toBe('Decrypting…');
    });

    deferredA.resolve({
      ok: true,
      data: {
        plaintext: 'decrypted:first-passphrase',
        plaintextBytes: new Uint8Array([1, 2, 3]),
        deliveredAt: MOCK_TIMESTAMP,
        receiverPubFpr: VALID_HEX,
      },
    });

    await waitFor(() => {
      const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
      expect(decryptButton.disabled).toBe(true);
      expect(decryptButton.textContent).toBe('Decrypting…');
    });

    deferredB.resolve({
      ok: true,
      data: {
        plaintext: 'decrypted:second-passphrase',
        plaintextBytes: new Uint8Array([4, 5, 6]),
        deliveredAt: MOCK_TIMESTAMP,
        receiverPubFpr: VALID_HEX,
      },
    });

    await waitFor(() => {
      const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
      expect(decryptButton.disabled).toBe(false);
      expect(decryptButton.textContent).toBe('Decrypt');
    });
  });

  it('does not clear current pending when stale decrypt throws', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    const uuidBPublic = createDeferred<Response>();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
            securityProfile: SECURITY_PROFILE.SECURE,
          })
        );
      }
      if (url === '/api/public/uuidbbbbbbbbbbbbbbbbb') {
        return uuidBPublic.promise;
      }

      return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
    });

    const deferredA = createDeferred<{
      ok: true;
      data: {
        plaintext: string;
        plaintextBytes: Uint8Array;
        deliveredAt: number;
        receiverPubFpr: string;
      };
    }>();
    const deferredB = createDeferred<{
      ok: true;
      data: {
        plaintext: string;
        plaintextBytes: Uint8Array;
        deliveredAt: number;
        receiverPubFpr: string;
      };
    }>();

    decryptDeliveredMock
      .mockImplementationOnce(() => deferredA.promise)
      .mockImplementationOnce(() => deferredB.promise);

    const router = createMemoryRouter(
      [
        {
          path: '/s/:uuid',
          element: <SharePage />,
        },
      ],
      {
        initialEntries: ['/s/uuidaaaaaaaaaaaaaaaaa'],
      }
    );

    render(<RouterProvider router={router} />);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'first-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await router.navigate('/s/uuidbbbbbbbbbbbbbbbbb');
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/public/uuidbbbbbbbbbbbbbbbbb');
    });
    uuidBPublic.resolve(
      jsonResponse({
        ok: true,
        state: 'delivered',
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
      })
    );
    expect(await waitForDeliveredDecryptPanel()).toBeTruthy();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'second-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await waitFor(() => {
      expect(decryptDeliveredMock).toHaveBeenCalledTimes(2);
      const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
      expect(decryptButton.disabled).toBe(true);
      expect(decryptButton.textContent).toBe('Decrypting…');
    });

    deferredA.reject(new Error('stale decrypt failure'));

    await waitFor(() => {
      const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
      expect(decryptButton.disabled).toBe(true);
      expect(decryptButton.textContent).toBe('Decrypting…');
      expect(screen.queryByTestId('share-decrypt-error')).toBeNull();
    });

    deferredB.resolve({
      ok: true,
      data: {
        plaintext: 'decrypted:second-passphrase',
        plaintextBytes: new Uint8Array([7, 8, 9]),
        deliveredAt: MOCK_TIMESTAMP,
        receiverPubFpr: VALID_HEX,
      },
    });

    await waitFor(() => {
      const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
      expect(decryptButton.disabled).toBe(false);
      expect(decryptButton.textContent).toBe('Decrypt');
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

  it('shows loading and does not leak old plaintext while uuid route changes', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    const uuidBPublic = createDeferred<Response>();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
            securityProfile: SECURITY_PROFILE.SECURE,
          })
        );
      }
      if (url === '/api/public/uuidbbbbbbbbbbbbbbbbb') {
        return uuidBPublic.promise;
      }

      return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
    });

    const router = createMemoryRouter(
      [
        {
          path: '/s/:uuid',
          element: <SharePage />,
        },
      ],
      {
        initialEntries: ['/s/uuidaaaaaaaaaaaaaaaaa'],
      }
    );

    render(<RouterProvider router={router} />);

    expect(await waitForDeliveredDecryptPanel()).toBeTruthy();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));
    expect(await screen.findByTestId('share-decrypt-plaintext')).toBeTruthy();

    await router.navigate('/s/uuidbbbbbbbbbbbbbbbbb');

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/public/uuidbbbbbbbbbbbbbbbbb');
    });
    const loading = screen.getByTestId('share-step-loading');
    expect(loading).toBeTruthy();
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.getAttribute('aria-live')).toBe('polite');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('share-decrypt-plaintext')).toBeNull();

    uuidBPublic.resolve(
      jsonResponse({
        ok: true,
        state: 'waiting',
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
      })
    );

    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();
    expect(screen.queryByTestId('share-decrypt-plaintext')).toBeNull();
  });

  it('resets lock step and passphrase after leaving and returning to same uuid', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/public/${VALID_UUID}`) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'waiting',
            adminMode: 'webauthn',
            securityProfile: SECURITY_PROFILE.SECURE,
          })
        );
      }

      return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
    });

    const router = createMemoryRouter(
      [
        {
          path: '/s/:uuid',
          element: <SharePage />,
        },
        {
          path: '/m/:uuid',
          element: <div data-testid="manage-page-stub">Manage</div>,
        },
      ],
      {
        initialEntries: [`/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`],
      }
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();
    fireEvent.click(screen.getByTestId('share-continue-button'));

    const passphraseInput = screen.getByTestId('passphrase-input-field') as HTMLInputElement;
    fireEvent.change(passphraseInput, {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    expect(passphraseInput.value).toBe('Strong#Pass1234XYZ');

    await router.navigate(`/m/${VALID_UUID}`);
    expect(await screen.findByTestId('manage-page-stub')).toBeTruthy();

    await router.navigate(`/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`);
    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();

    fireEvent.click(screen.getByTestId('share-continue-button'));
    const returnPassphraseInput = screen.getByTestId('passphrase-input-field') as HTMLInputElement;
    expect(returnPassphraseInput.value).toBe('');
  });

  it('renders unavailable state when /api/public/:uuid returns 404', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicNotFound(fetchSpy);

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-unavailable')).toBeTruthy();
    expect(screen.getByText('Channel Unavailable')).toBeTruthy();
    expect(
      screen.getByText('This channel was destroyed, expired, or does not exist.')
    ).toBeTruthy();
  });

  it('cleans up the local receiver key when /api/public/:uuid returns 404', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicNotFound(fetchSpy);
    const remove = vi.fn(() => Promise.resolve());
    const storageSpy = vi
      .spyOn(storageModule, 'createIndexedDbReceiverKeyStorage')
      .mockReturnValue(createMockReceiverKeyStorage({ remove }));

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    try {
      expect(await screen.findByTestId('share-step-unavailable')).toBeTruthy();
      await waitFor(() => {
        expect(remove).toHaveBeenCalledWith(VALID_UUID);
      });
    } finally {
      storageSpy.mockRestore();
    }
  });

  it.each([
    'deleted',
    'expired',
  ] as const)('renders unavailable state when /api/public/:uuid returns legacy %s', async (state) => {
    const fetchSpy = getFetchSpy();
    mockLegacyTerminalPublicState(fetchSpy, state);

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('share-step-onboarding')).toBeNull();
    expect(screen.queryByTestId('share-step-delivered')).toBeNull();
    expect(decryptDeliveredMock).not.toHaveBeenCalled();
    expect(lockChannelMock).not.toHaveBeenCalled();
  });

  it.each([
    'deleted',
    'expired',
  ] as const)('cleans up the local receiver key when /api/public/:uuid returns legacy %s', async (state) => {
    const fetchSpy = getFetchSpy();
    mockLegacyTerminalPublicState(fetchSpy, state);
    const remove = vi.fn(() => Promise.resolve());
    const storageSpy = vi
      .spyOn(storageModule, 'createIndexedDbReceiverKeyStorage')
      .mockReturnValue(createMockReceiverKeyStorage({ remove }));

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    try {
      expect(await screen.findByTestId('share-step-unavailable')).toBeTruthy();
      await waitFor(() => {
        expect(remove).toHaveBeenCalledWith(VALID_UUID);
      });
    } finally {
      storageSpy.mockRestore();
    }
  });

  it('cleans up the local receiver key when realtime state changes to a terminal state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    const remove = vi.fn(() => Promise.resolve());
    const storageSpy = vi
      .spyOn(storageModule, 'createIndexedDbReceiverKeyStorage')
      .mockReturnValue(createMockReceiverKeyStorage({ remove }));

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    try {
      expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();

      act(() => {
        getLatestChannelSyncOptions().onStateChange({
          state: 'expired',
          version: 1,
          adminMode: 'webauthn',
          securityProfile: SECURITY_PROFILE.SECURE,
        });
      });

      expect(await screen.findByTestId('share-step-unavailable')).toBeTruthy();
      await waitFor(() => {
        expect(remove).toHaveBeenCalledWith(VALID_UUID);
      });
    } finally {
      storageSpy.mockRestore();
    }
  });

  it('cleans up the local receiver key when realtime close is received', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    const remove = vi.fn(() => Promise.resolve());
    const storageSpy = vi
      .spyOn(storageModule, 'createIndexedDbReceiverKeyStorage')
      .mockReturnValue(createMockReceiverKeyStorage({ remove }));

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    try {
      expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();

      act(() => {
        getLatestChannelSyncOptions().onChannelClosed('expired');
      });

      expect(await screen.findByTestId('share-step-unavailable')).toBeTruthy();
      await waitFor(() => {
        expect(remove).toHaveBeenCalledWith(VALID_UUID);
      });
    } finally {
      storageSpy.mockRestore();
    }
  });

  it.each([
    429, 500, 503,
  ] as const)('shows public-status error notice when /api/public/:uuid returns HTTP %i', async (status) => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: false, code: 'ERROR' }, status));

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-public-status-error')).toBeTruthy();
    expect(
      screen.getByText('Unable to load channel state right now. Showing safe default state.')
    ).toBeTruthy();
    expect(screen.queryByTestId('share-step-unavailable')).toBeNull();
  });

  it.each([
    429, 500, 503,
  ] as const)('does not clean up the local receiver key when /api/public/:uuid returns HTTP %i', async (status) => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: false, code: 'ERROR' }, status));
    const remove = vi.fn(() => Promise.resolve());
    const storageSpy = vi
      .spyOn(storageModule, 'createIndexedDbReceiverKeyStorage')
      .mockReturnValue(createMockReceiverKeyStorage({ remove }));

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    try {
      expect(await screen.findByTestId('share-public-status-error')).toBeTruthy();
      expect(remove).not.toHaveBeenCalled();
    } finally {
      storageSpy.mockRestore();
    }
  });

  it('shows uuid and receiver role badge', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await screen.findByTestId('share-step-onboarding');
    expect(screen.getByTestId('share-uuid').textContent).toContain(VALID_UUID);
    expect(screen.getByText('Receiver')).toBeTruthy();
  });

  it('falls back to (missing) label and skips network/decrypt calls when uuid param is absent', () => {
    const fetchSpy = getFetchSpy();
    renderSharePage('/s', '/s');

    expect(screen.getByTestId('share-uuid').textContent).toContain('(missing)');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lockChannelMock).not.toHaveBeenCalled();
    expect(decryptDeliveredMock).not.toHaveBeenCalled();
  });

  it('does not update state after unmount during pending lock request', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    const deferred = createDeferred<{
      ok: true;
      data: {
        receiverPubJwk: {
          kty: 'RSA';
          alg: 'RSA-OAEP-256';
          n: string;
          e: string;
          ext: true;
          key_ops: ['encrypt'];
        };
        receiverPubFpr: string;
      };
    }>();
    lockChannelMock.mockReturnValueOnce(deferred.promise);

    const { unmount } = renderSharePage('/s/:uuid', `/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    fireEvent.click(screen.getByTestId('share-generate-button'));

    await waitFor(() => {
      expect(lockChannelMock).toHaveBeenCalledTimes(1);
    });

    unmount();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    deferred.resolve({
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
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('shows user-friendly error when lockChannel throws an exception', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    lockChannelMock.mockRejectedValueOnce(new Error('unexpected crash'));

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    fireEvent.click(screen.getByTestId('share-generate-button'));

    expect(await screen.findByTestId('share-lock-error')).toBeTruthy();
    const errorText = screen.getByTestId('share-lock-error').textContent;
    expect(errorText).toBe('An unexpected error occurred. Please try again.');
    expect(errorText).not.toContain('INTERNAL_ERROR');
  });

  it('shows generic fallback error when lockChannel returns an unknown error code', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    lockChannelMock.mockResolvedValueOnce({
      ok: false,
      error: {
        ok: false,
        code: 'TOTALLY_UNKNOWN_CODE_XYZ',
        stage: 'lock.begin',
      },
    });

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}#k=${VALID_LOCK_SECRET}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    fireEvent.click(screen.getByTestId('share-generate-button'));

    expect(await screen.findByTestId('share-lock-error')).toBeTruthy();
    const errorText = screen.getByTestId('share-lock-error').textContent;
    expect(errorText).toBe('Lock failed. Please try again.');
    expect(errorText).not.toContain('TOTALLY_UNKNOWN_CODE_XYZ');
  });
});
