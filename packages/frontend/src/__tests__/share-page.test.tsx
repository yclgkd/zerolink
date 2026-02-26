// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharePage } from '../pages/SharePage';

const originalFetch = globalThis.fetch;
const VALID_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_B64U = 'bW9ja19iYXNlNjR1cmw';
const MOCK_TIMESTAMP = 1_700_000_000_000;

function getFetchSpy(): ReturnType<typeof vi.fn> {
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

    renderSharePage();

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/public/demo-channel-shell');
    });

    expect(screen.getByTestId('page-share')).toBeTruthy();
    expect(screen.getByTestId('share-step-onboarding')).toBeTruthy();
    expect(screen.getByText('Your passphrase stays on this device')).toBeTruthy();
  });

  it('moves from onboarding to lock form when continuing in waiting state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage();

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));

    expect(screen.getByTestId('share-step-lock')).toBeTruthy();
  });

  it('renders passphrase input and lock actions in lock form state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage();

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));

    expect(screen.getByTestId('passphrase-input-field')).toBeTruthy();
    expect(screen.getByTestId('share-back-button')).toBeTruthy();
    expect(screen.getByTestId('share-generate-button')).toBeTruthy();
  });

  it('keeps generate button disabled when passphrase is empty', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage();

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    const generateButton = screen.getByTestId('share-generate-button') as HTMLButtonElement;

    expect(generateButton.disabled).toBe(true);
  });

  it('allows waiting lock flow to reach locked view as local UI state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage();

    await screen.findByTestId('share-step-onboarding');
    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    fireEvent.click(screen.getByTestId('share-generate-button'));

    expect(screen.getByTestId('share-step-locked')).toBeTruthy();
    expect(screen.getByText('Safety Code')).toBeTruthy();
  });

  it('renders locked state from /api/public/:uuid with safety code and next steps', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');
    renderSharePage();

    expect(await screen.findByTestId('share-step-locked')).toBeTruthy();
    expect(screen.getByText('Safety Code')).toBeTruthy();
    expect(screen.getByTestId('share-next-steps')).toBeTruthy();
  });

  it('renders delivered state and fetches decrypt payload', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');
    mockDecryptFetchSuccess(fetchSpy);

    renderSharePage();

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith('/api/public/demo-channel-shell');
    expect(fetchSpy).toHaveBeenCalledWith('/api/decrypt_fetch/demo-channel-shell');
    expect(await screen.findByTestId('share-decrypt-summary')).toBeTruthy();
    expect(screen.getByText('Content Delivered')).toBeTruthy();
  });

  it('shows loading and clears stale decrypt data while uuid route changes', async () => {
    const fetchSpy = getFetchSpy();
    const uuidBPublic = createDeferred<Response>();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/uuid-a') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'delivered',
          })
        );
      }
      if (url === '/api/decrypt_fetch/uuid-a') {
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
      if (url === '/api/public/uuid-b') {
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
        initialEntries: ['/s/uuid-a'],
      }
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(await screen.findByTestId('share-decrypt-summary')).toBeTruthy();

    await router.navigate('/s/uuid-b');

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/public/uuid-b');
    });
    expect(screen.getByTestId('share-step-loading')).toBeTruthy();
    expect(screen.queryByTestId('share-decrypt-summary')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalledWith('/api/decrypt_fetch/uuid-b');

    uuidBPublic.resolve(
      jsonResponse({
        ok: true,
        state: 'waiting',
      })
    );

    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalledWith('/api/decrypt_fetch/uuid-b');
  });

  it('shows non-blocking decrypt fetch error in delivered state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: false, code: 'BAD_REQUEST' }, 400));

    renderSharePage();

    expect(await screen.findByTestId('share-step-delivered')).toBeTruthy();
    expect(await screen.findByTestId('share-decrypt-error')).toBeTruthy();
    expect(screen.getByText('Unable to load encrypted payload preview.')).toBeTruthy();
  });

  it('renders deleted terminal state from /api/public/:uuid', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'deleted');

    renderSharePage();

    expect(await screen.findByTestId('share-step-deleted')).toBeTruthy();
    expect(screen.getByText('Channel Deleted')).toBeTruthy();
    expect(
      screen.getByText('This channel has been destroyed and cannot be recovered.')
    ).toBeTruthy();
  });

  it('renders expired terminal state from /api/public/:uuid', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'expired');

    renderSharePage();

    expect(await screen.findByTestId('share-step-expired')).toBeTruthy();
    expect(screen.getByText('Channel Expired')).toBeTruthy();
    expect(
      screen.getByText('The channel exceeded its lifetime and is no longer valid for delivery.')
    ).toBeTruthy();
  });

  it('shows uuid and receiver role badge', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');
    renderSharePage();

    await screen.findByTestId('share-step-onboarding');
    expect(screen.getByTestId('share-uuid').textContent).toContain('demo-channel-shell');
    expect(screen.getByText('Receiver')).toBeTruthy();
  });

  it('falls back to missing uuid label and skips network fetch when uuid param is absent', () => {
    const fetchSpy = getFetchSpy();
    renderSharePage('/s', '/s');

    expect(screen.getByTestId('share-uuid').textContent).toContain('(missing uuid)');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retries decrypt fetch when clicking Retry button', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'delivered');
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: false, code: 'BAD_REQUEST' }, 400));

    renderSharePage();

    expect(await screen.findByTestId('share-decrypt-error')).toBeTruthy();

    mockDecryptFetchSuccess(fetchSpy);
    fireEvent.click(screen.getByTestId('share-decrypt-retry'));

    expect(await screen.findByTestId('share-decrypt-summary')).toBeTruthy();
  });
});
