// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HexStringSchema } from '@zerolink/shared';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lockChannelMock } = vi.hoisted(() => ({
  lockChannelMock: vi.fn(),
}));

vi.mock('../crypto/orchestrator', async () => {
  return {
    cryptoOrchestrator: {
      lockChannel: lockChannelMock,
    },
  };
});

import { SharePage } from '../pages/SharePage';
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
  state: 'waiting' | 'locked' | 'delivered' | 'deleted' | 'expired'
) {
  fetchSpy.mockResolvedValueOnce(
    jsonResponse({
      ok: true,
      state,
    })
  );
}

function mockDecryptFetchSuccess(fetchSpy: ReturnType<typeof vi.fn>) {
  fetchSpy.mockResolvedValueOnce(
    jsonResponse({
      ok: true,
      cipherBundle: {
        ciphertext: VALID_B64U,
        iv: VALID_B64U,
        aad: VALID_B64U,
        encContentKey: VALID_B64U,
        ciphertextHash: VALID_HEX,
        padBlock: 4096,
      },
      receiverPubFpr: VALID_HEX,
      deliveredAt: MOCK_TIMESTAMP,
    })
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  useLockStore.getState().resetLockStore();
  vi.clearAllMocks();
  mockLockSuccessWithStoreSideEffects();
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
    expect(screen.getByText('Your passphrase stays on this device')).toBeTruthy();
  });

  it('moves from onboarding to lock form when continuing in waiting state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));

    expect(screen.getByTestId('share-step-lock')).toBeTruthy();
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

    expect(screen.getByTestId('share-lock-secret-warning')).toBeTruthy();
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
    expect(await screen.findByTestId('share-lock-error')).toBeTruthy();
    expect(screen.queryByTestId('share-step-locked')).toBeNull();
  });

  it('shows safety unavailable hint when server state is locked but local safety code is missing', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    expect(screen.getByTestId('share-safety-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
  });

  it('renders delivered state and fetches decrypt payload', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');
    mockDecryptFetchSuccess(fetchSpy);

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(`/api/public/${VALID_UUID}`);
    expect(fetchSpy).toHaveBeenCalledWith(`/api/decrypt_fetch/${VALID_UUID}`);
    expect(await screen.findByTestId('share-decrypt-summary')).toBeTruthy();
    expect(screen.getByText('Content Delivered')).toBeTruthy();
  });

  it('shows loading and clears stale decrypt data while uuid route changes', async () => {
    const fetchSpy = getFetchSpy();
    const uuidBPublic = createDeferred<Response>();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
          })
        );
      }
      if (url === '/api/decrypt_fetch/uuidaaaaaaaaaaaaaaaaa') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            cipherBundle: {
              ciphertext: VALID_B64U,
              iv: VALID_B64U,
              aad: VALID_B64U,
              encContentKey: VALID_B64U,
              ciphertextHash: VALID_HEX,
              padBlock: 4096,
            },
            receiverPubFpr: VALID_HEX,
            deliveredAt: MOCK_TIMESTAMP,
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
    expect(await screen.findByTestId('share-decrypt-summary')).toBeTruthy();

    await router.navigate('/s/uuidbbbbbbbbbbbbbbbbb');

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/public/uuidbbbbbbbbbbbbbbbbb');
    });
    expect(screen.getByTestId('share-step-loading')).toBeTruthy();
    expect(screen.queryByTestId('share-decrypt-summary')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalledWith('/api/decrypt_fetch/uuidbbbbbbbbbbbbbbbbb');

    uuidBPublic.resolve(
      jsonResponse({
        ok: true,
        state: 'waiting',
      })
    );

    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalledWith('/api/decrypt_fetch/uuidbbbbbbbbbbbbbbbbb');
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

  it('shows non-blocking decrypt fetch error in delivered state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: false, code: 'BAD_REQUEST' }, 400));

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(await screen.findByTestId('share-decrypt-error')).toBeTruthy();
    expect(screen.getByText('Unable to load encrypted payload preview.')).toBeTruthy();
  });

  it('renders deleted terminal state from /api/public/:uuid', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'deleted');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-deleted')).toBeTruthy();
    expect(screen.getByText('Channel Deleted')).toBeTruthy();
    expect(
      screen.getByText('This channel has been destroyed and cannot be recovered.')
    ).toBeTruthy();
  });

  it('renders expired terminal state from /api/public/:uuid', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'expired');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-expired')).toBeTruthy();
    expect(screen.getByText('Channel Expired')).toBeTruthy();
    expect(
      screen.getByText('The channel exceeded its lifetime and is no longer valid for delivery.')
    ).toBeTruthy();
  });

  it('shows uuid and receiver role badge', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await screen.findByTestId('share-step-onboarding');
    expect(screen.getByTestId('share-uuid').textContent).toContain(VALID_UUID);
    expect(screen.getByText('Receiver')).toBeTruthy();
  });

  it('falls back to missing uuid label and skips network fetch when uuid param is absent', () => {
    const fetchSpy = getFetchSpy();
    renderSharePage('/s', '/s');

    expect(screen.getByTestId('share-uuid').textContent).toContain('(missing uuid)');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lockChannelMock).not.toHaveBeenCalled();
  });

  it('retries decrypt fetch when clicking Retry button', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: false, code: 'BAD_REQUEST' }, 400));

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-decrypt-error')).toBeTruthy();

    mockDecryptFetchSuccess(fetchSpy);
    fireEvent.click(screen.getByTestId('share-decrypt-retry'));

    expect(await screen.findByTestId('share-decrypt-summary')).toBeTruthy();
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

    // Resolve after unmount — should not throw or log errors
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

    // Flush microtasks so the resolved promise handler runs
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
