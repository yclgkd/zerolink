import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapApp,
  initializeMocking,
  isMockEnabled,
  type MockWorkerLoader,
} from '../bootstrap';
import type { ReleaseVerificationResult, VerifiedReleaseSnapshot } from '../release/verification';

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
});
