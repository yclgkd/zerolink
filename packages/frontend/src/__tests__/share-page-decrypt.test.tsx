// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { SECURITY_PROFILE } from '@zerolink/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lockChannelMock, decryptDeliveredMock, toastSuccessMock, syncHarness } = vi.hoisted(() => ({
  lockChannelMock: vi.fn(),
  decryptDeliveredMock: vi.fn(),
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
}));

import { useDecryptStore } from '../stores/decrypt-store';
import { useLockStore } from '../stores/lock-store';
import {
  clearReceiverKeyStorage,
  getFetchSpy,
  getLatestChannelSyncOptions,
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
  syncHarness.latestOptions = null;
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

describe('SharePage – decryptDelivered action', () => {
  it('does not render safety code after a realtime delivered update if this device lacks the local receiver key', async () => {
    const fetchSpy = getFetchSpy();
    mockPublicState(fetchSpy, 'waiting');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    expect(await screen.findByTestId('share-step-onboarding')).toBeTruthy();

    act(() => {
      getLatestChannelSyncOptions(syncHarness).onStateChange({
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
      getLatestChannelSyncOptions(syncHarness).onStateChange({
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
    expect(screen.getByText('Enter a passphrase with at least 12 characters')).toBeTruthy();
  });

  it('keeps decrypt button disabled when passphrase is shorter than 12 characters in delivered state', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'short' },
    });

    const decryptButton = screen.getByTestId('share-decrypt-button') as HTMLButtonElement;
    expect(decryptButton.disabled).toBe(true);
    expect(screen.getByText('Enter a passphrase with at least 12 characters')).toBeTruthy();
    expect(decryptDeliveredMock).not.toHaveBeenCalled();
  });

  it('does not show passphrase strength feedback in delivered decrypt state', async () => {
    const fetchSpy = getFetchSpy();
    await saveReceiverEnvelopesForDeliveredTests();
    mockPublicState(fetchSpy, 'delivered');

    renderSharePage('/s/:uuid', `/s/${VALID_UUID}`);

    await waitForDeliveredDecryptPanel();
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Receiver#Pass1234' },
    });

    expect(screen.queryByTestId('passphrase-strength-segment-1')).toBeNull();
    expect(screen.queryByTestId('passphrase-strength-segment-2')).toBeNull();
    expect(screen.queryByTestId('passphrase-strength-segment-3')).toBeNull();
  });
});
