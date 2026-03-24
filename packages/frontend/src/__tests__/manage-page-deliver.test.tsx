// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SECURITY_PROFILE } from '@zerolink/shared';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { deliverSecretMock, deleteChannelMock, toastSuccessMock, syncHarness } = vi.hoisted(() => ({
  deliverSecretMock: vi.fn(),
  deleteChannelMock: vi.fn(),
  toastSuccessMock: vi.fn(),
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
      deliverSecret: deliverSecretMock,
      deleteChannel: deleteChannelMock,
    },
  };
});

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock },
  Toaster: () => null,
}));

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

import { ManagePage } from '../pages/ManagePage';
import { useCreateStore } from '../stores/create-store';
import { useDeliverStore } from '../stores/deliver-store';

const originalFetch = globalThis.fetch;
const originalClipboard = navigator.clipboard;

const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const NEXT_UUID = 'bbbbbbbbbbbbbbbbbbbbb';
const VALID_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function renderManagePage(routePath = '/m/:uuid', initialPath = `/m/${VALID_UUID}`) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ManagePage />} path={routePath} />
      </Routes>
    </MemoryRouter>
  );
}

function renderManagePageWithRouter(initialPath = `/m/${VALID_UUID}`) {
  const router = createMemoryRouter(
    [
      {
        path: '/m/:uuid',
        element: <ManagePage />,
      },
    ],
    {
      initialEntries: [initialPath],
    }
  );

  return { router, ...render(<RouterProvider router={router} />) };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function getFetchSpy(): ReturnType<typeof vi.fn> {
  if (!vi.isMockFunction(globalThis.fetch)) {
    throw new Error('global fetch is not mocked');
  }

  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function mockPublicState(
  fetchSpy: ReturnType<typeof vi.fn>,
  state: string,
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

function mockDeliverSuccessWithStoreSideEffects(): void {
  deliverSecretMock.mockImplementation(async () => {
    useDeliverStore.getState().markDelivered();
    return { ok: true, data: {} };
  });
}

function mockDeleteSuccessWithStoreSideEffects(): void {
  deleteChannelMock.mockImplementation(async () => {
    useDeliverStore.getState().markDeleted();
    return { ok: true, data: {} };
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function getLatestChannelSyncOptions() {
  if (!syncHarness.latestOptions) {
    throw new Error('useChannelSync options were not captured');
  }

  return syncHarness.latestOptions;
}

async function waitForManageActionsEnabled(): Promise<void> {
  await waitFor(() => {
    expect((screen.getByTestId('manage-destroy-button') as HTMLButtonElement).disabled).toBe(false);
  });
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  useCreateStore.getState().resetCreateStore();
  useDeliverStore.getState().resetDeliverStore();
  syncHarness.latestOptions = null;

  vi.clearAllMocks();
  deliverSecretMock.mockReset();
  deleteChannelMock.mockReset();
  mockDeliverSuccessWithStoreSideEffects();
  mockDeleteSuccessWithStoreSideEffects();
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

  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

describe('ManagePage – deliver actions', () => {
  it('shows the channel password input when a password-managed delete is being confirmed', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        state: 'waiting',
        adminMode: 'password',
        securityProfile: SECURITY_PROFILE.QUICK,
      })
    );

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    fireEvent.click(screen.getByTestId('manage-destroy-button'));

    expect(screen.getByTestId('manage-softkey-passphrase-section')).toBeTruthy();
    expect(screen.getByLabelText('Channel password')).toBeTruthy();
    expect(screen.getByText(/password-protected management key/i)).toBeTruthy();
  });

  it('calls deliverSecret with quick profile and channel password for password adminMode', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        state: 'locked',
        adminMode: 'password',
        securityProfile: SECURITY_PROFILE.QUICK,
      })
    );

    useCreateStore.getState().setSelectedProfile(SECURITY_PROFILE.QUICK);

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'top secret payload' },
    });
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Quick#Manage123' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect(deliverSecretMock).toHaveBeenCalledTimes(1);
    });

    const callArg = deliverSecretMock.mock.calls[0]?.[0];
    expect(callArg?.uuid).toBe(VALID_UUID);
    expect(callArg?.profile).toBe(SECURITY_PROFILE.QUICK);
    expect(callArg?.plaintext).toBe('top secret payload');
    expect(callArg?.softkeyPassphrase).toBe('Quick#Manage123');

    expect(await screen.findByTestId('manage-state-delivered')).toBeTruthy();
  });

  it('shows the channel password error when password-managed delivery omits a password', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        state: 'locked',
        adminMode: 'password',
        securityProfile: SECURITY_PROFILE.QUICK,
      })
    );

    deliverSecretMock.mockResolvedValueOnce({
      ok: false,
      error: { ok: false, code: 'PASSPHRASE_REQUIRED', stage: 'deliver.softkey-passphrase' },
    });

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'top secret payload' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    expect((await screen.findByTestId('manage-action-error')).textContent).toContain(
      'Channel password must be at least 8 characters'
    );
  });

  it('blocks password-managed delivery locally when the channel password is shorter than 8 characters', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        state: 'locked',
        adminMode: 'password',
        securityProfile: SECURITY_PROFILE.QUICK,
      })
    );

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'top secret payload' },
    });
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    expect((await screen.findByTestId('manage-action-error')).textContent).toContain(
      'Channel password must be at least 8 characters'
    );
    expect(deliverSecretMock).not.toHaveBeenCalled();
  });

  it('calls deliverSecret with quick profile for softkey-managed channels', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        state: 'locked',
        adminMode: 'softkey',
        securityProfile: SECURITY_PROFILE.QUICK,
      })
    );

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'top secret payload' },
    });
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Compat#Manage123' },
    });
    await waitFor(() => {
      expect((screen.getByTestId('passphrase-input-field') as HTMLInputElement).value).toBe(
        'Compat#Manage123'
      );
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect(deliverSecretMock).toHaveBeenCalledTimes(1);
    });

    const callArg = deliverSecretMock.mock.calls[0]?.[0];
    expect(callArg?.uuid).toBe(VALID_UUID);
    expect(callArg?.profile).toBe(SECURITY_PROFILE.QUICK);
    expect(callArg?.plaintext).toBe('top secret payload');
    expect(callArg?.softkeyPassphrase).toBe('Compat#Manage123');

    expect(await screen.findByTestId('manage-state-delivered')).toBeTruthy();
  });

  it('uses backend securityProfile for webauthn-managed delivery even when create state conflicts', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        state: 'locked',
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
      })
    );

    useCreateStore.getState().setSelectedProfile(SECURITY_PROFILE.QUICK);
    useCreateStore.getState().setCreatedProfile(SECURITY_PROFILE.QUICK);

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect(deliverSecretMock).toHaveBeenCalledTimes(1);
    });
    expect(deliverSecretMock.mock.calls[0]?.[0]?.profile).toBe(SECURITY_PROFILE.SECURE);
  });

  it('uses realtime-updated securityProfile for later delivery actions', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    act(() => {
      getLatestChannelSyncOptions().onStateChange({
        state: 'locked',
        version: 2,
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
      });
    });

    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload after sync' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect(deliverSecretMock).toHaveBeenCalledTimes(1);
    });
    expect(deliverSecretMock.mock.calls[0]?.[0]?.profile).toBe(SECURITY_PROFILE.SECURE);
  });

  it('disables deliver/destroy while deliver request is pending and re-enables after completion', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    const deferred = createDeferred<{
      ok: true;
      data: Record<string, never>;
    }>();
    deliverSecretMock.mockReturnValueOnce(deferred.promise);

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect((screen.getByTestId('manage-deliver-button') as HTMLButtonElement).disabled).toBe(
        true
      );
      expect((screen.getByTestId('manage-destroy-button') as HTMLButtonElement).disabled).toBe(
        true
      );
    });

    deferred.resolve({ ok: true, data: {} });

    await waitFor(() => {
      expect((screen.getByTestId('manage-destroy-button') as HTMLButtonElement).disabled).toBe(
        false
      );
    });
  });

  it('resets pending actions when navigating to another uuid while deliver is in-flight', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/public/${VALID_UUID}` || url === `/api/public/${NEXT_UUID}`) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'locked',
            adminMode: 'webauthn',
            securityProfile: SECURITY_PROFILE.SECURE,
          })
        );
      }

      return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
    });

    const deferred = createDeferred<{
      ok: true;
      data: Record<string, never>;
    }>();
    deliverSecretMock.mockReturnValueOnce(deferred.promise);

    const { router } = renderManagePageWithRouter();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
    await waitForManageActionsEnabled();
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect((screen.getByTestId('manage-deliver-button') as HTMLButtonElement).disabled).toBe(
        true
      );
      expect((screen.getByTestId('manage-destroy-button') as HTMLButtonElement).disabled).toBe(
        true
      );
    });

    await router.navigate(`/m/${NEXT_UUID}`);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(`/api/public/${NEXT_UUID}`);
    });
    expect(await screen.findByTestId('manage-state-locked')).toBeTruthy();
    expect(screen.getByTestId('manage-uuid').textContent).toContain(NEXT_UUID);
    expect((screen.getByTestId('manage-destroy-button') as HTMLButtonElement).disabled).toBe(false);

    deferred.resolve({ ok: true, data: {} });
  });

  it('ignores stale deliver failure after navigating to a new uuid', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/public/${VALID_UUID}` || url === `/api/public/${NEXT_UUID}`) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            state: 'locked',
            adminMode: 'webauthn',
            securityProfile: SECURITY_PROFILE.SECURE,
          })
        );
      }

      return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
    });

    const deferred = createDeferred<{
      ok: false;
      error: { ok: false; code: 'BAD_REQUEST'; stage: 'deliver.commit' };
    }>();
    deliverSecretMock.mockReturnValueOnce(deferred.promise);

    const { router } = renderManagePageWithRouter();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await router.navigate(`/m/${NEXT_UUID}`);
    expect(await screen.findByTestId('manage-state-locked')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('manage-uuid').textContent).toContain(NEXT_UUID);
    });
    expect(screen.queryByTestId('manage-action-error')).toBeNull();

    deferred.resolve({
      ok: false,
      error: { ok: false, code: 'BAD_REQUEST', stage: 'deliver.commit' },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('manage-action-error')).toBeNull();
      expect(screen.getByTestId('manage-state-locked')).toBeTruthy();
    });
  });

  it('keeps safety code visible after successful deliver transitions state from locked to delivered', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    expect(screen.getByTestId('safety-code-root')).toBeTruthy();

    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'my secret payload' },
    });
    await waitForManageActionsEnabled();
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await screen.findByTestId('manage-state-delivered');
    expect(screen.getByTestId('safety-code-root')).toBeTruthy();
    expect(screen.queryByTestId('manage-safety-unavailable')).toBeNull();
  });

  it('clears secret input and passphrase after successful delivery', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        state: 'locked',
        adminMode: 'password',
        securityProfile: SECURITY_PROFILE.QUICK,
      })
    );

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'top secret payload' },
    });
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Quick#Manage123' },
    });

    expect((screen.getByTestId('manage-secret-input') as HTMLTextAreaElement).value).toBe(
      'top secret payload'
    );
    expect((screen.getByTestId('passphrase-input-field') as HTMLInputElement).value).toBe(
      'Quick#Manage123'
    );

    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await screen.findByTestId('manage-state-delivered');
    expect((screen.getByTestId('manage-secret-input') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByTestId('passphrase-input-field') as HTMLInputElement).value).toBe('');
  });

  it('shows action error on deliver failure and keeps non-delivered state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    deliverSecretMock.mockResolvedValueOnce({
      ok: false,
      error: { ok: false, code: 'BAD_REQUEST', stage: 'deliver.commit' },
    });

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
    await waitForManageActionsEnabled();
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    const error = await screen.findByTestId('manage-action-error');
    expect(error).toBeTruthy();
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.getAttribute('aria-live')).toBe('assertive');
    expect(
      (screen.getByTestId('manage-secret-input') as HTMLTextAreaElement).getAttribute(
        'aria-invalid'
      )
    ).toBeNull();
    expect(
      (screen.getByTestId('manage-secret-input') as HTMLTextAreaElement).getAttribute(
        'aria-describedby'
      )
    ).toBeNull();
    expect(screen.getByTestId('manage-state-locked')).toBeTruthy();
  });

  it('shows INTERNAL_ERROR and logs to console when deliverSecret throws', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    deliverSecretMock.mockRejectedValueOnce(new TypeError('unexpected crypto failure'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
    await waitForManageActionsEnabled();
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    const error = await screen.findByTestId('manage-action-error');
    expect(error.textContent).toContain('Unexpected internal error');
    expect(screen.getByTestId('manage-state-locked')).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[useManageDeliveryLogic] deliverSecret threw unexpectedly',
      expect.objectContaining({ uuid: VALID_UUID })
    );

    consoleErrorSpy.mockRestore();
  });

  it('calls toast.success after successful deliver', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    await waitForManageActionsEnabled();
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'top secret payload' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledOnce();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Secret delivered successfully.');
  });
});
