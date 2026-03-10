// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapApp,
  initializeMocking,
  isMockEnabled,
  isReleaseVerificationRequiredByDefault,
  type MockWorkerLoader,
} from '../bootstrap';
import type { ReleaseVerificationResult, VerifiedReleaseSnapshot } from '../release/verification';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('isMockEnabled', () => {
  it('enables only when mock=true is present', () => {
    expect(isMockEnabled('?mock=true')).toBe(true);
    expect(isMockEnabled('?foo=bar&mock=true')).toBe(true);
    expect(isMockEnabled('?mock=false')).toBe(false);
    expect(isMockEnabled('?mock=TRUE')).toBe(false);
    expect(isMockEnabled('')).toBe(false);
  });
});

describe('initializeMocking', () => {
  it('loads and starts the MSW worker when mock mode is enabled', async () => {
    const sequence: string[] = [];
    const loadWorker: MockWorkerLoader = async () => {
      sequence.push('load');
      return {
        worker: {
          start: async () => {
            sequence.push('start');
          },
        },
      };
    };

    await initializeMocking('?mock=true', loadWorker);
    expect(sequence).toEqual(['load', 'start']);
  });

  it('skips worker loading when mock mode is disabled', async () => {
    const loadWorker = vi.fn(async () => ({
      worker: {
        start: async () => undefined,
      },
    }));

    await initializeMocking('?mock=false', loadWorker);
    expect(loadWorker).not.toHaveBeenCalled();
  });

  it('skips worker loading when not in dev mode', async () => {
    const loadWorker = vi.fn(async () => ({
      worker: {
        start: async () => undefined,
      },
    }));

    await initializeMocking('?mock=true', loadWorker, false);
    expect(loadWorker).not.toHaveBeenCalled();
  });
});

describe('isReleaseVerificationRequiredByDefault', () => {
  it('requires production mode and an explicit enable flag', () => {
    expect(isReleaseVerificationRequiredByDefault(true, 'true')).toBe(true);
    expect(isReleaseVerificationRequiredByDefault(true, 'false')).toBe(false);
    expect(isReleaseVerificationRequiredByDefault(true, undefined)).toBe(false);
    expect(isReleaseVerificationRequiredByDefault(false, 'true')).toBe(false);
  });
});

function createVerifiedSnapshot(): VerifiedReleaseSnapshot {
  return {
    buildTime: '2026-03-08T12:34:56.000Z',
    commitHash: 'abc1234',
    manifestHash: 'f'.repeat(64),
    publicKeyFingerprint: 'a'.repeat(64),
    signature: 'signed-release',
    status: 'verified',
    verifiedFileCount: 4,
    version: '1.2.3',
  };
}

describe('bootstrapApp', () => {
  it('loads the app only after release verification succeeds in production mode', async () => {
    const sequence: string[] = [];

    await bootstrapApp({
      initializeMockingFn: async () => {
        sequence.push('mocking');
      },
      isReleaseVerificationRequired: true,
      loadApp: async () => {
        sequence.push('load-app');
      },
      renderVerificationGate: (state) => {
        sequence.push(`gate:${state.status}`);
      },
      search: '?mock=true',
      setVerifiedReleaseSnapshot: (snapshot) => {
        sequence.push(snapshot?.status ?? 'no-snapshot');
      },
      verifyReleaseFn: async (): Promise<ReleaseVerificationResult> => createVerifiedSnapshot(),
    });

    expect(sequence).toEqual(['mocking', 'gate:verifying', 'verified', 'load-app']);
  });

  it('renders a blocking failure state and never loads the app when verification fails', async () => {
    const loadApp = vi.fn(async () => undefined);
    const renderVerificationGate = vi.fn();

    await bootstrapApp({
      initializeMockingFn: async () => undefined,
      isReleaseVerificationRequired: true,
      loadApp,
      renderVerificationGate,
      search: '',
      setVerifiedReleaseSnapshot: vi.fn(),
      verifyReleaseFn: async (): Promise<ReleaseVerificationResult> => ({
        detail: 'Main asset hash mismatch.',
        reason: 'asset_hash_mismatch',
        status: 'failed',
      }),
    });

    expect(loadApp).not.toHaveBeenCalled();
    expect(renderVerificationGate).toHaveBeenNthCalledWith(1, { status: 'verifying' });
    expect(renderVerificationGate).toHaveBeenNthCalledWith(2, {
      detail: 'Main asset hash mismatch.',
      reason: 'asset_hash_mismatch',
      status: 'failed',
    });
  });

  it('bypasses release verification entirely outside production mode', async () => {
    const verifyReleaseFn = vi.fn();
    const loadApp = vi.fn(async () => undefined);

    await bootstrapApp({
      initializeMockingFn: async () => undefined,
      isReleaseVerificationRequired: false,
      loadApp,
      renderVerificationGate: vi.fn(),
      search: '',
      setVerifiedReleaseSnapshot: vi.fn(),
      verifyReleaseFn,
    });

    expect(verifyReleaseFn).not.toHaveBeenCalled();
    expect(loadApp).toHaveBeenCalledTimes(1);
  });

  it('defaults to bypassing release verification when the release flag is not enabled', async () => {
    const verifyReleaseFn = vi.fn();
    const loadApp = vi.fn(async () => undefined);

    await bootstrapApp({
      initializeMockingFn: async () => undefined,
      loadApp,
      renderVerificationGate: vi.fn(),
      search: '',
      setVerifiedReleaseSnapshot: vi.fn(),
      verifyReleaseFn,
    });

    expect(verifyReleaseFn).not.toHaveBeenCalled();
    expect(loadApp).toHaveBeenCalledTimes(1);
  });

  it('reloads once instead of rendering a failure gate on entry asset mismatch', async () => {
    const loadApp = vi.fn(async () => undefined);
    const renderVerificationGate = vi.fn();
    const recoverEntryMismatchFn = vi.fn(() => true);

    await bootstrapApp({
      initializeMockingFn: async () => undefined,
      isReleaseVerificationRequired: true,
      loadApp,
      recoverEntryMismatchFn,
      renderVerificationGate,
      search: '',
      setVerifiedReleaseSnapshot: vi.fn(),
      verifyReleaseFn: async (): Promise<ReleaseVerificationResult> => ({
        detail: 'Entry mismatch.',
        reason: 'entry_asset_mismatch',
        status: 'failed',
      }),
    });

    expect(loadApp).not.toHaveBeenCalled();
    expect(renderVerificationGate).toHaveBeenCalledTimes(1);
    expect(renderVerificationGate).toHaveBeenCalledWith({ status: 'verifying' });
    expect(recoverEntryMismatchFn).toHaveBeenCalledTimes(1);
  });

  it('renders the blocking failure after a single recovery reload has already been attempted', async () => {
    const loadApp = vi.fn(async () => undefined);
    const renderVerificationGate = vi.fn();

    window.sessionStorage.setItem('zerolink-release-entry-reload-attempted', 'true');

    await bootstrapApp({
      initializeMockingFn: async () => undefined,
      isReleaseVerificationRequired: true,
      loadApp,
      recoverEntryMismatchFn: () => false,
      renderVerificationGate,
      search: '',
      setVerifiedReleaseSnapshot: vi.fn(),
      verifyReleaseFn: async (): Promise<ReleaseVerificationResult> => ({
        detail: 'Entry mismatch.',
        reason: 'entry_asset_mismatch',
        status: 'failed',
      }),
    });

    expect(loadApp).not.toHaveBeenCalled();
    expect(renderVerificationGate).toHaveBeenNthCalledWith(2, {
      detail: 'Entry mismatch.',
      reason: 'entry_asset_mismatch',
      status: 'failed',
    });
  });

  it('clears the recovery reload marker after a verified boot', async () => {
    window.sessionStorage.setItem('zerolink-release-entry-reload-attempted', 'true');

    await bootstrapApp({
      initializeMockingFn: async () => undefined,
      isReleaseVerificationRequired: true,
      loadApp: async () => undefined,
      renderVerificationGate: vi.fn(),
      search: '',
      setVerifiedReleaseSnapshot: vi.fn(),
      verifyReleaseFn: async (): Promise<ReleaseVerificationResult> => createVerifiedSnapshot(),
    });

    expect(window.sessionStorage.getItem('zerolink-release-entry-reload-attempted')).toBeNull();
  });
});
