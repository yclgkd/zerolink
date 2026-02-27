// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SECURITY_PROFILE } from '@zerolink/shared';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { deliverSecretMock, deleteChannelMock } = vi.hoisted(() => ({
  deliverSecretMock: vi.fn(),
  deleteChannelMock: vi.fn(),
}));

vi.mock('../crypto/orchestrator', async () => {
  return {
    cryptoOrchestrator: {
      deliverSecret: deliverSecretMock,
      deleteChannel: deleteChannelMock,
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

function mockPublicState(fetchSpy: ReturnType<typeof vi.fn>, state: string) {
  fetchSpy.mockResolvedValueOnce(
    jsonResponse({
      ok: true,
      state,
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

beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  useCreateStore.getState().resetCreateStore();
  useDeliverStore.getState().resetDeliverStore();

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
  });

  it('shows sender role badge and uuid value', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderManagePage();

    expect(await screen.findByText('Sender')).toBeTruthy();
    expect(screen.getByTestId('manage-uuid').textContent).toContain(VALID_UUID);
  });

  it('falls back to missing uuid label and blocks deliver/delete when uuid is absent', async () => {
    const fetchSpy = getFetchSpy();

    renderManagePage('/m', '/m');

    expect(screen.getByTestId('manage-uuid').textContent).toContain('(missing uuid)');
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-button'));

    await waitFor(() => {
      expect(deliverSecretMock).not.toHaveBeenCalled();
      expect(deleteChannelMock).not.toHaveBeenCalled();
    });
  });

  it('renders locked state from public status and shows safety unavailable by default', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();

    expect(await screen.findByTestId('manage-state-locked')).toBeTruthy();
    const warning = screen.getByTestId('manage-safety-unavailable');
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByTestId('safety-code-root')).toBeNull();
  });

  it('renders real safety code in locked state when receiver fingerprint exists in store', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'locked');

    renderManagePage();

    expect(await screen.findByTestId('manage-state-locked')).toBeTruthy();
    useDeliverStore.setState({ receiverPubFpr: VALID_HEX as never });
    expect(await screen.findByTestId('safety-code-root')).toBeTruthy();
    expect(screen.queryByTestId('manage-safety-unavailable')).toBeNull();
  });

  it('keeps deliver disabled while secret input is empty', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    const deliverButton = screen.getByTestId('manage-deliver-button') as HTMLButtonElement;
    expect(deliverButton.disabled).toBe(true);
  });

  it('calls deliverSecret with uuid/profile/plaintext and transitions to delivered on success', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    useCreateStore.getState().setSelectedProfile(SECURITY_PROFILE.STRICT);

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'top secret payload' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect(deliverSecretMock).toHaveBeenCalledTimes(1);
    });

    const callArg = deliverSecretMock.mock.calls[0]?.[0];
    expect(callArg?.uuid).toBe(VALID_UUID);
    expect(callArg?.profile).toBe(SECURITY_PROFILE.STRICT);
    expect(callArg?.plaintext).toBe('top secret payload');

    expect(await screen.findByTestId('manage-state-delivered')).toBeTruthy();
  });

  it('prefers createdProfile over selectedProfile when delivering', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    useCreateStore.getState().setSelectedProfile(SECURITY_PROFILE.STRICT);
    useCreateStore.getState().setCreatedProfile(SECURITY_PROFILE.HARDWARE_ONLY);

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await waitFor(() => {
      expect(deliverSecretMock).toHaveBeenCalledTimes(1);
    });
    expect(deliverSecretMock.mock.calls[0]?.[0]?.profile).toBe(SECURITY_PROFILE.HARDWARE_ONLY);
  });

  it('disables deliver/destroy while deliver request is pending and re-enables after completion', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    const deferred = createDeferred<{ ok: true; data: Record<string, never> }>();
    deliverSecretMock.mockReturnValueOnce(deferred.promise);

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
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
            state: 'waiting',
          })
        );
      }

      return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
    });

    const deferred = createDeferred<{ ok: true; data: Record<string, never> }>();
    deliverSecretMock.mockReturnValueOnce(deferred.promise);

    const { router } = renderManagePageWithRouter();

    await screen.findByTestId('manage-state-waiting');
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

    await router.navigate(`/m/${NEXT_UUID}`);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(`/api/public/${NEXT_UUID}`);
    });
    expect(await screen.findByTestId('manage-state-waiting')).toBeTruthy();
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
            state: 'waiting',
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

    await screen.findByTestId('manage-state-waiting');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    await router.navigate(`/m/${NEXT_UUID}`);
    expect(await screen.findByTestId('manage-state-waiting')).toBeTruthy();
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
      expect(screen.getByTestId('manage-state-waiting')).toBeTruthy();
    });
  });

  it('shows action error on deliver failure and keeps non-delivered state', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    deliverSecretMock.mockResolvedValueOnce({
      ok: false,
      error: { ok: false, code: 'BAD_REQUEST', stage: 'deliver.commit' },
    });

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');
    fireEvent.change(screen.getByTestId('manage-secret-input'), {
      target: { value: 'payload' },
    });
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
    expect(screen.getByTestId('manage-state-waiting')).toBeTruthy();
  });

  it('uses inline destroy confirm and transitions to deleted after confirm', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderManagePage();

    await screen.findByTestId('manage-state-waiting');

    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    expect(screen.getByTestId('manage-destroy-confirm')).toBeTruthy();

    fireEvent.click(screen.getByTestId('manage-destroy-cancel'));
    expect(screen.queryByTestId('manage-destroy-confirm')).toBeNull();

    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));

    await waitFor(() => {
      expect(deleteChannelMock).toHaveBeenCalledTimes(1);
    });

    expect(deleteChannelMock.mock.calls[0]?.[0]?.uuid).toBe(VALID_UUID);
    expect(deleteChannelMock.mock.calls[0]?.[0]?.profile).toBe(SECURITY_PROFILE.STANDARD);
    expect(await screen.findByTestId('manage-state-deleted')).toBeTruthy();
  });

  it('disables confirm panel actions while delete request is pending', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    const deferred = createDeferred<{ ok: true; data: Record<string, never> }>();
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

  it('renders expired state from API and disables destructive actions', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'expired');

    renderManagePage();

    expect(await screen.findByTestId('manage-state-expired')).toBeTruthy();

    const deliverButton = screen.getByTestId('manage-deliver-button') as HTMLButtonElement;
    const destroyButton = screen.getByTestId('manage-destroy-button') as HTMLButtonElement;

    expect(deliverButton.disabled).toBe(true);
    expect(destroyButton.disabled).toBe(true);

    fireEvent.click(destroyButton);
    expect(screen.queryByTestId('manage-destroy-confirm')).toBeNull();
  });

  it('shows public status error when /api/public fails but keeps page interactive', async () => {
    const fetchSpy = getFetchSpy();
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    renderManagePage();

    const warning = await screen.findByTestId('manage-public-status-error');
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('manage-state-waiting')).toBeTruthy();
  });

  it('keeps copy label when clipboard api is unavailable', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderManagePage();
    await screen.findByTestId('manage-state-waiting');

    Reflect.deleteProperty(navigator, 'clipboard');

    const copyButton = screen.getByTestId('manage-copy-button');
    fireEvent.click(copyButton);

    expect(copyButton.textContent).toBe('Copy');
  });

  it('shows copied label only after clipboard write succeeds', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderManagePage();
    await screen.findByTestId('manage-state-waiting');

    const copyButton = screen.getByTestId('manage-copy-button');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(copyButton.textContent).toBe('Copied');
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/s/${VALID_UUID}`));
  });
});
