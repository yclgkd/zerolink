// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HexStringSchema } from '@zerolink/shared';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lockChannelMock, decryptDeliveredMock } = vi.hoisted(() => ({
  lockChannelMock: vi.fn(),
  decryptDeliveredMock: vi.fn(),
}));

vi.mock('../crypto/orchestrator', async () => {
  return {
    cryptoOrchestrator: {
      lockChannel: lockChannelMock,
      decryptDelivered: decryptDeliveredMock,
    },
  };
});

import { SharePage } from '../pages/SharePage';
import { useDecryptStore } from '../stores/decrypt-store';
import { useLockStore } from '../stores/lock-store';

const originalFetch = globalThis.fetch;
const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const VALID_HEX = HexStringSchema.parse(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);
const VALID_B64U = 'bW9ja19iYXNlNjR1cmw';
const VALID_LOCK_SECRET = 'bW9ja19sb2NrX3NlY3JldA';
const MOCK_TIMESTAMP = 1_700_000_000_000;

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
  state: 'waiting' | 'locked' | 'delivered'
) {
  fetchSpy.mockResolvedValueOnce(
    jsonResponse({
      ok: true,
      state,
      adminMode: 'webauthn',
    })
  );
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

beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  useLockStore.getState().resetLockStore();
  useDecryptStore.getState().resetDecryptStore();
  vi.clearAllMocks();
  mockLockSuccessWithStoreSideEffects();
  mockDecryptSuccessWithStoreSideEffects();
});

afterEach(() => {
  cleanup();

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
    expect(screen.getByTestId('share-step-onboarding')).toBeTruthy();
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

  it('shows safety unavailable hint when server state is locked but local safety code is missing', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    const warning = screen.getByTestId('share-safety-unavailable');
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
  });

  it('renders delivered decrypt panel and does not fetch /api/decrypt_fetch directly', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(screen.getByTestId('share-decrypt-panel')).toBeTruthy();
    expect(screen.getByText('Channel Delivered')).toBeTruthy();
    expect(
      screen.getByText('The channel is delivered. Decrypt happens locally on this device.')
    ).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(`/api/public/${VALID_UUID}`);
    expect(fetchSpy).not.toHaveBeenCalledWith(`/api/decrypt_fetch/${VALID_UUID}`);
  });

  it('keeps decrypt button disabled when passphrase is empty in delivered state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await screen.findByTestId('share-step-delivered');
    const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
    expect(decryptButton.disabled).toBe(true);
  });

  it('calls decryptDelivered with uuid/passphrase and shows plaintext on success', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await screen.findByTestId('share-step-delivered');
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

    await screen.findByTestId('share-step-delivered');
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
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await screen.findByTestId('share-step-delivered');
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
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
          })
        );
      }
      if (url === '/api/public/uuidbbbbbbbbbbbbbbbbb') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
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

    await screen.findByTestId('share-step-delivered');
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
    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();

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
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
          })
        );
      }
      if (url === '/api/public/uuidbbbbbbbbbbbbbbbbb') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
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

    await screen.findByTestId('share-step-delivered');
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'first-passphrase' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    await router.navigate('/s/uuidbbbbbbbbbbbbbbbbb');
    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
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
    const uuidBPublic = createDeferred<Response>();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
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

    await screen.findByTestId('share-step-delivered');
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
      })
    );
    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
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
    const uuidBPublic = createDeferred<Response>();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
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

    await screen.findByTestId('share-step-delivered');
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
      })
    );
    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
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

    await screen.findByTestId('share-step-delivered');
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

    await screen.findByTestId('share-step-delivered');
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

    await screen.findByTestId('share-step-delivered');
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });
    fireEvent.click(screen.getByTestId('share-decrypt-button'));

    expect(await screen.findByTestId('share-decrypt-error')).toBeTruthy();
    expect(screen.getByText('Ciphertext integrity verification failed.')).toBeTruthy();
  });

  it('burns local plaintext, shows local-only notice, and clears passphrase', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await screen.findByTestId('share-step-delivered');
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
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await screen.findByTestId('share-step-delivered');
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
    const uuidBPublic = createDeferred<Response>();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
            adminMode: 'webauthn',
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

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
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
