// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SECURITY_PROFILE } from '@zerolink/shared';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { deliverSecretMock, deleteChannelMock, syncHarness } = vi.hoisted(() => ({
  deliverSecretMock: vi.fn(),
  deleteChannelMock: vi.fn(),
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

describe('ManagePage integration', () => {
  it('calls /api/public/:uuid on mount and renders waiting state from API', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderManagePage();

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(`/api/public/${VALID_UUID}`);
    });

    expect(screen.getByTestId('page-manage')).toBeTruthy();
    expect(await screen.findByTestId('manage-state-waiting')).toBeTruthy();
    expect(screen.getByText('Delete Channel')).toBeTruthy();
    expect(screen.queryByText('Destroy')).toBeNull();
  });

  it('shows sender role badge and uuid value', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderManagePage();

    expect(await screen.findByText('Sender')).toBeTruthy();
    expect(screen.getByTestId('manage-uuid').textContent).toContain(VALID_UUID);
  });

  it('falls back to (missing) label and blocks deliver/delete when uuid is absent', async () => {
    const fetchSpy = getFetchSpy();

    renderManagePage('/m', '/m');

    expect(screen.getByTestId('manage-uuid').textContent).toContain('(missing)');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('manage-secret-input')).toBeNull();
    expect(screen.queryByTestId('manage-deliver-button')).toBeNull();

    fireEvent.click(screen.getByTestId('manage-destroy-button'));

    await waitFor(() => {
      expect(deliverSecretMock).not.toHaveBeenCalled();
      expect(deleteChannelMock).not.toHaveBeenCalled();
    });
  });

  it('renders locked state fallback when public status is missing receiver fingerprint', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked', { receiverPubFpr: null });

    renderManagePage();

    expect(await screen.findByTestId('manage-state-locked')).toBeTruthy();
    const warning = screen.getByTestId('manage-safety-unavailable');
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('Safety Code unavailable right now.')).toBeTruthy();
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
  });

  it('renders real safety code in locked state when public status includes receiver fingerprint', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();

    expect(await screen.findByTestId('manage-state-locked')).toBeTruthy();
    expect(await screen.findByTestId('safety-code-root')).toBeTruthy();
    expect(screen.queryByTestId('manage-safety-unavailable')).toBeNull();
  });

  it('hides delivery composer while waiting for receiver lock', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    expect(screen.queryByTestId('manage-secret-input')).toBeNull();
    expect(screen.queryByTestId('manage-deliver-button')).toBeNull();
    expect(screen.getByTestId('manage-destroy-button')).toBeTruthy();
  });

  it('keeps deliver disabled while secret input is empty after receiver lock', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    const deliverButton = screen.getByTestId('manage-deliver-button') as HTMLButtonElement;
    expect(deliverButton.disabled).toBe(true);
  });

  it('hides the channel password input while password-managed channels are still waiting', async () => {
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
    expect(screen.queryByTestId('manage-softkey-passphrase-section')).toBeNull();
    expect(screen.queryByLabelText('Channel password')).toBeNull();
  });

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

  it('does not show the channel password input for webauthn-managed channels', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        state: 'waiting',
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
      })
    );

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    expect(screen.queryByTestId('manage-softkey-passphrase-section')).toBeNull();
    expect(screen.queryByLabelText('Channel password')).toBeNull();
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
      'A channel password is required for this action.'
    );
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
        securityProfile: SECURITY_PROFILE.STANDARD,
      })
    );

    useCreateStore.getState().setSelectedProfile(SECURITY_PROFILE.QUICK);
    useCreateStore.getState().setCreatedProfile(SECURITY_PROFILE.HARDWARE_ONLY);

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect(deliverSecretMock).toHaveBeenCalledTimes(1);
    });
    expect(deliverSecretMock.mock.calls[0]?.[0]?.profile).toBe(SECURITY_PROFILE.STANDARD);
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
        securityProfile: SECURITY_PROFILE.STANDARD,
      });
    });

    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload after sync' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect(deliverSecretMock).toHaveBeenCalledTimes(1);
    });
    expect(deliverSecretMock.mock.calls[0]?.[0]?.profile).toBe(SECURITY_PROFILE.STANDARD);
  });

  it('keeps the safety code visible while compound begin loads and after retryable begin errors', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    expect(screen.getByTestId('safety-code-root')).toBeTruthy();

    act(() => {
      useDeliverStore.getState().startCompoundBegin();
    });

    expect(screen.getByTestId('safety-code-root')).toBeTruthy();
    expect(screen.queryByTestId('manage-safety-unavailable')).toBeNull();

    act(() => {
      useDeliverStore.getState().failCompoundBegin('NETWORK_ERROR');
    });

    expect(screen.getByTestId('safety-code-root')).toBeTruthy();
    expect(screen.queryByTestId('manage-safety-unavailable')).toBeNull();
  });

  it('falls back to the safety warning after terminal compound begin errors', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();

    await screen.findByTestId('manage-state-locked');
    expect(screen.getByTestId('safety-code-root')).toBeTruthy();

    act(() => {
      useDeliverStore.getState().failCompoundBegin('NOT_FOUND');
    });

    expect(screen.queryByTestId('safety-code-root')).toBeNull();
    expect(screen.getByTestId('manage-safety-unavailable')).toBeTruthy();
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

  it('keeps manage actions disabled until public status resolves', async () => {
    const fetchSpy = getFetchSpy();
    const publicStatus = createDeferred<Response>();
    fetchSpy.mockReturnValueOnce(publicStatus.promise);

    renderManagePage();

    expect(screen.queryByTestId('manage-secret-input')).toBeNull();
    expect(screen.queryByTestId('manage-deliver-button')).toBeNull();
    expect((screen.getByTestId('manage-destroy-button') as HTMLButtonElement).disabled).toBe(true);

    publicStatus.resolve(
      jsonResponse({
        ok: true,
        state: 'locked',
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.SECURE,
      })
    );

    await screen.findByTestId('manage-state-locked');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
    await waitFor(() => {
      expect((screen.getByTestId('manage-destroy-button') as HTMLButtonElement).disabled).toBe(
        false
      );
      expect((screen.getByTestId('manage-deliver-button') as HTMLButtonElement).disabled).toBe(
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

  it('uses inline destroy confirm and transitions to deleted after confirm', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');

    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    expect(screen.getByTestId('manage-destroy-confirm')).toBeTruthy();
    expect(screen.getByText('Permanently delete this channel?')).toBeTruthy();
    expect(screen.getByText('Confirm Delete')).toBeTruthy();

    fireEvent.click(screen.getByTestId('manage-destroy-cancel'));
    expect(screen.queryByTestId('manage-destroy-confirm')).toBeNull();

    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));

    await waitFor(() => {
      expect(deleteChannelMock).toHaveBeenCalledTimes(1);
    });

    expect(deleteChannelMock.mock.calls[0]?.[0]?.uuid).toBe(VALID_UUID);
    expect(deleteChannelMock.mock.calls[0]?.[0]?.profile).toBe(SECURITY_PROFILE.SECURE);
    expect(await screen.findByTestId('manage-state-deleted')).toBeTruthy();
    expect(
      screen.getByText('You deleted this channel. It can no longer deliver or decrypt content.')
    ).toBeTruthy();
    expect(screen.getByTestId('manage-create-new-button')).toBeTruthy();
    expect(screen.queryByTestId('manage-deliver-button')).toBeNull();
    expect(screen.queryByTestId('manage-destroy-button')).toBeNull();
  });

  it('keeps deleted state when realtime close follows a local delete', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));
    await screen.findByTestId('manage-state-deleted');

    act(() => {
      getLatestChannelSyncOptions().onChannelClosed('deleted');
    });

    expect(screen.getByTestId('manage-state-deleted')).toBeTruthy();
    expect(screen.queryByTestId('manage-state-unavailable')).toBeNull();
  });

  it('uses quick profile for password-managed delete even when create state conflicts', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        state: 'waiting',
        adminMode: 'password',
        securityProfile: SECURITY_PROFILE.QUICK,
      })
    );

    useCreateStore.getState().setSelectedProfile(SECURITY_PROFILE.STRICT);
    useCreateStore.getState().setCreatedProfile(SECURITY_PROFILE.HARDWARE_ONLY);

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));

    await waitFor(() => {
      expect(deleteChannelMock).toHaveBeenCalledTimes(1);
    });

    expect(deleteChannelMock.mock.calls[0]?.[0]?.profile).toBe(SECURITY_PROFILE.QUICK);
  });

  it('shows unavailable state after remounting a locally deleted channel', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    const firstRender = renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));
    await screen.findByTestId('manage-state-deleted');

    firstRender.unmount();
    mockPublicNotFound(fetchSpy);

    renderManagePage();

    expect(await screen.findByTestId('manage-state-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('manage-state-deleted')).toBeNull();
  });

  it('disables confirm panel actions while delete request is pending', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    const deferred = createDeferred<{
      ok: true;
      data: Record<string, never>;
    }>();
    deleteChannelMock.mockReturnValueOnce(deferred.promise);

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));

    await waitFor(() => {
      expect((screen.getByTestId('manage-destroy-cancel') as HTMLButtonElement).disabled).toBe(
        true
      );
      expect(
        (screen.getByTestId('manage-destroy-confirm-apply') as HTMLButtonElement).disabled
      ).toBe(true);
    });
    expect(screen.getByText('Deleting…')).toBeTruthy();

    deferred.resolve({ ok: true, data: {} });
  });

  it('shows action error on delete failure', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    deleteChannelMock.mockResolvedValueOnce({
      ok: false,
      error: { ok: false, code: 'PROFILE_BLOCKED', stage: 'delete.assert' },
    });

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));

    expect(await screen.findByTestId('manage-action-error')).toBeTruthy();
    expect(screen.getByTestId('manage-state-waiting')).toBeTruthy();
  });

  it('ignores stale delete failure after navigating to a new uuid', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/public/${VALID_UUID}` || url === `/api/public/${NEXT_UUID}`) {
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

    const deferred = createDeferred<{
      ok: false;
      error: { ok: false; code: 'PROFILE_BLOCKED'; stage: 'delete.assert' };
    }>();
    deleteChannelMock.mockReturnValueOnce(deferred.promise);

    const { router } = renderManagePageWithRouter();

    await screen.findByTestId('manage-state-waiting');
    await waitForManageActionsEnabled();
    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));

    await router.navigate(`/m/${NEXT_UUID}`);
    expect(await screen.findByTestId('manage-state-waiting')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('manage-uuid').textContent).toContain(NEXT_UUID);
    });
    expect(screen.queryByTestId('manage-action-error')).toBeNull();
    expect(screen.queryByTestId('manage-state-deleted')).toBeNull();

    deferred.resolve({
      ok: false,
      error: { ok: false, code: 'PROFILE_BLOCKED', stage: 'delete.assert' },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('manage-action-error')).toBeNull();
      expect(screen.getByTestId('manage-state-waiting')).toBeTruthy();
      expect(screen.queryByTestId('manage-state-deleted')).toBeNull();
    });
  });

  it('renders unavailable state from API 404 and shows create new button instead of action buttons', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicNotFound(fetchSpy);

    renderManagePage();

    expect(await screen.findByTestId('manage-state-unavailable')).toBeTruthy();

    expect(screen.queryByTestId('manage-share-link-card')).toBeNull();
    expect(screen.queryByTestId('manage-deliver-button')).toBeNull();
    expect(screen.queryByTestId('manage-destroy-button')).toBeNull();
    expect(screen.getByTestId('manage-create-new-button')).toBeTruthy();
  });

  it('shows unavailable state when realtime close arrives from a non-terminal state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();

    await screen.findByTestId('manage-state-locked');

    act(() => {
      getLatestChannelSyncOptions().onChannelClosed('expired');
    });

    expect(await screen.findByTestId('manage-state-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('manage-deliver-button')).toBeNull();
    expect(screen.queryByTestId('manage-destroy-button')).toBeNull();
  });

  it.each([
    'deleted',
    'expired',
  ] as const)('renders unavailable state from legacy public status %s', async (state) => {
    const fetchSpy = getFetchSpy();
    mockLegacyTerminalPublicState(fetchSpy, state);

    renderManagePage();

    expect(await screen.findByTestId('manage-state-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('manage-share-link-card')).toBeNull();
    expect(screen.queryByTestId('manage-state-deleted')).toBeNull();
    expect(screen.queryByTestId('manage-deliver-button')).toBeNull();
    expect(screen.queryByTestId('manage-destroy-button')).toBeNull();
    expect(screen.getByTestId('manage-create-new-button')).toBeTruthy();
  });

  it('shows public status error when /api/public fails and keeps actions disabled', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    renderManagePage();

    const warning = await screen.findByTestId('manage-public-status-error');
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('manage-state-waiting')).toBeTruthy();
    expect(screen.queryByTestId('manage-secret-input')).toBeNull();
    expect(screen.queryByTestId('manage-deliver-button')).toBeNull();
    expect((screen.getByTestId('manage-destroy-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('clears public status error when realtime state arrives after load failure', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    renderManagePage();

    await screen.findByTestId('manage-public-status-error');

    act(() => {
      getLatestChannelSyncOptions().onStateChange({
        state: 'locked',
        version: 1,
        adminMode: 'webauthn',
        securityProfile: SECURITY_PROFILE.STANDARD,
        receiverPubFpr: VALID_HEX,
      });
    });

    expect(screen.queryByTestId('manage-public-status-error')).toBeNull();
    expect(await screen.findByTestId('manage-state-locked')).toBeTruthy();
    expect(screen.getByTestId('safety-code-root')).toBeTruthy();
  });

  it('hides SECRET PAYLOAD input after successful destroy', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();
    await screen.findByTestId('manage-state-locked');
    await waitForManageActionsEnabled();

    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'my secret text' },
    });
    expect((screen.getByTestId('manage-secret-input') as HTMLTextAreaElement).value).toBe(
      'my secret text'
    );

    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));

    await screen.findByTestId('manage-state-deleted');
    expect(screen.queryByTestId('manage-share-link-card')).toBeNull();
    expect(screen.queryByTestId('manage-secret-input')).toBeNull();
  });

  it('retains SECRET PAYLOAD content after destroy failure', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    deleteChannelMock.mockResolvedValueOnce({
      ok: false,
      error: { ok: false, code: 'PROFILE_BLOCKED', stage: 'delete.assert' },
    });

    renderManagePage();
    await screen.findByTestId('manage-state-locked');

    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'my secret text' },
    });

    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));

    await screen.findByTestId('manage-action-error');
    expect((screen.getByTestId('manage-secret-input') as HTMLTextAreaElement).value).toBe(
      'my secret text'
    );
  });

  it('hides SECRET PAYLOAD input when channel is unavailable', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicNotFound(fetchSpy);

    renderManagePage();

    await screen.findByTestId('manage-state-unavailable');
    expect(screen.queryByTestId('manage-secret-input')).toBeNull();
  });

  it('does not render share link copy controls while managing a channel', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderManagePage();
    await screen.findByTestId('manage-state-waiting');
    expect(screen.queryByTestId('manage-share-link-card')).toBeNull();
    expect(screen.queryByTestId('manage-share-link-value')).toBeNull();
    expect(screen.queryByTestId('manage-copy-button')).toBeNull();
  });

  it('navigates to home when create new button is clicked after destroy', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    const router = createMemoryRouter(
      [
        { path: '/', element: <div data-testid="home-page">Home</div> },
        { path: '/m/:uuid', element: <ManagePage /> },
      ],
      { initialEntries: [`/m/${VALID_UUID}`] }
    );
    render(<RouterProvider router={router} />);

    await screen.findByTestId('manage-state-waiting');
    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));

    await screen.findByTestId('manage-state-deleted');
    fireEvent.click(screen.getByTestId('manage-create-new-button'));

    await waitFor(() => {
      expect(screen.getByTestId('home-page')).toBeTruthy();
    });
  });

  it('shows create new button in terminal actions for unavailable state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicNotFound(fetchSpy);

    renderManagePage();

    await screen.findByTestId('manage-state-unavailable');
    expect(screen.getByTestId('manage-terminal-actions')).toBeTruthy();
    expect(screen.getByTestId('manage-create-new-button')).toBeTruthy();
  });
});
