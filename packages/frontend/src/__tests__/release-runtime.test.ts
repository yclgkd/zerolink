// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getVerifiedReleaseSnapshot, setVerifiedReleaseSnapshot } from '../release/runtime';
import type { VerifiedReleaseSnapshot } from '../release/verification';

function createSnapshot(): VerifiedReleaseSnapshot {
  return {
    status: 'verified',
    version: '1.2.3',
    commitHash: 'abc1234',
    buildTime: '2026-03-08T12:34:56.000Z',
    manifestHash: 'f'.repeat(64),
    verifiedFileCount: 4,
    signature: 'signed-release',
    publicKeyFingerprint: 'a'.repeat(64),
  };
}

afterEach(() => {
  if (typeof window !== 'undefined') {
    delete window.__ZEROLINK_RELEASE_VERIFICATION__;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('release runtime snapshot cache', () => {
  it('returns null when no verified snapshot is cached', () => {
    expect(getVerifiedReleaseSnapshot()).toBeNull();
  });

  it('stores and reads back the verified snapshot', () => {
    const snapshot = createSnapshot();

    setVerifiedReleaseSnapshot(snapshot);

    expect(getVerifiedReleaseSnapshot()).toEqual(snapshot);
  });

  it('removes the verified snapshot when null is provided', () => {
    setVerifiedReleaseSnapshot(createSnapshot());

    setVerifiedReleaseSnapshot(null);

    expect(getVerifiedReleaseSnapshot()).toBeNull();
  });

  it('gracefully no-ops when window is unavailable', () => {
    vi.stubGlobal('window', undefined);

    expect(getVerifiedReleaseSnapshot()).toBeNull();
    expect(() => setVerifiedReleaseSnapshot(createSnapshot())).not.toThrow();
    expect(() => setVerifiedReleaseSnapshot(null)).not.toThrow();
  });
});
