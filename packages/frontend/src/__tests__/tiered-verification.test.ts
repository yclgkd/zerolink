import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCachedDigest,
  readCachedDigest,
  type TrustedDigestCache,
  tieredVerifyRelease,
  writeCachedDigest,
} from '../release/tiered-verification';
import type { VerifiedReleaseSnapshot } from '../release/verification';
import { createFetchStub, createSignedManifestFixture } from './release-verification-test-helpers';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createManifestHashResponse(hash: string): Response {
  return new Response(`${hash}\n`, { status: 200 });
}

function makeSnapshot(
  fixture: ReturnType<typeof createSignedManifestFixture>
): VerifiedReleaseSnapshot {
  return {
    status: 'verified',
    version: fixture.manifest.version,
    commitHash: fixture.manifest.commitHash,
    buildTime: fixture.manifest.buildTime,
    manifestHash: fixture.manifestHash,
    verifiedFileCount: Object.keys(fixture.manifest.files).length,
    signature: fixture.signature,
    publicKeyFingerprint: 'test-fingerprint-abc123',
  };
}

function makeCache(
  fixture: ReturnType<typeof createSignedManifestFixture>,
  overrides: Partial<TrustedDigestCache> = {}
): TrustedDigestCache {
  return {
    manifestHash: fixture.manifestHash,
    version: fixture.manifest.version,
    publicKeyFingerprint: 'test-fingerprint-abc123',
    verifiedAt: Date.now(),
    snapshot: makeSnapshot(fixture),
    ...overrides,
  };
}

function createFetchWithHashStub(
  fixture: ReturnType<typeof createSignedManifestFixture>
): typeof fetch {
  const baseFetch = createFetchStub(fixture);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/manifest-hash.txt')) {
      return createManifestHashResponse(fixture.manifestHash);
    }
    return baseFetch(input, init);
  }) as typeof fetch;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const storageMap = new Map<string, string>();

beforeEach(() => {
  storageMap.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, value),
    removeItem: (key: string) => storageMap.delete(key),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Cache Storage Tests ─────────────────────────────────────────────────────

describe('cache storage helpers', () => {
  it('returns null when no cache exists', () => {
    expect(readCachedDigest()).toBeNull();
  });

  it('round-trips a valid cache entry', () => {
    const fixture = createSignedManifestFixture();
    const cache = makeCache(fixture);
    writeCachedDigest(cache);
    const read = readCachedDigest();
    expect(read).toEqual(cache);
  });

  it('returns null for corrupted JSON', () => {
    storageMap.set('zerolink:trusted-manifest-digest', 'not json');
    expect(readCachedDigest()).toBeNull();
  });

  it('returns null for invalid cache shape', () => {
    storageMap.set('zerolink:trusted-manifest-digest', JSON.stringify({ foo: 'bar' }));
    expect(readCachedDigest()).toBeNull();
  });

  it('clears cache', () => {
    const fixture = createSignedManifestFixture();
    writeCachedDigest(makeCache(fixture));
    clearCachedDigest();
    expect(readCachedDigest()).toBeNull();
  });
});

// ─── Tiered Verification Tests ───────────────────────────────────────────────

describe('tieredVerifyRelease', () => {
  it('returns tier=full on first run with no cache', async () => {
    const fixture = createSignedManifestFixture();
    const fetchStub = createFetchWithHashStub(fixture);

    const result = await tieredVerifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: fetchStub,
      publicKeyPem: fixture.publicPem,
    });

    expect(result.tier).toBe('full');
    expect(result.result.status).toBe('verified');
  });

  it('populates cache after successful full verification', async () => {
    const fixture = createSignedManifestFixture();
    const fetchStub = createFetchWithHashStub(fixture);

    await tieredVerifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: fetchStub,
      publicKeyPem: fixture.publicPem,
    });

    const cached = readCachedDigest();
    expect(cached).not.toBeNull();
    expect(cached?.manifestHash).toBe(fixture.manifestHash);
    expect(cached?.version).toBe(fixture.manifest.version);
  });

  it('re-validates signed manifest bytes even when cache is fresh', async () => {
    const fixture = createSignedManifestFixture();
    const cache = makeCache(fixture, { verifiedAt: Date.now() });
    writeCachedDigest(cache);

    const fetchSpy = vi.fn(createFetchWithHashStub(fixture));
    const result = await tieredVerifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: fetchSpy as typeof fetch,
      publicKeyPem: fixture.publicPem,
      nowMs: Date.now(),
    });

    expect(result.tier).toBe('signature_only');
    expect(result.result.status).toBe('verified');
    const fetchedUrls = fetchSpy.mock.calls.map((call) => {
      const input = call[0];
      return typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    });
    expect(fetchedUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('manifest-hash.txt'),
        expect.stringContaining('manifest.json'),
        expect.stringContaining('manifest.sig'),
      ])
    );
    expect(fetchedUrls).toHaveLength(3);
  });

  it('re-validates via signature when cache is expired (tier=signature_only)', async () => {
    const fixture = createSignedManifestFixture();
    const expiredTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    const cache = makeCache(fixture, { verifiedAt: expiredTime });
    writeCachedDigest(cache);

    const now = Date.now();
    const result = await tieredVerifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: createFetchWithHashStub(fixture),
      publicKeyPem: fixture.publicPem,
      nowMs: now,
    });

    // Expired cache skips Tier 1 → Tier 2 signature check passes with same hash → refreshes TTL
    expect(result.tier).toBe('signature_only');
    expect(result.result.status).toBe('verified');

    // Cache should be refreshed with new verifiedAt
    const refreshed = readCachedDigest();
    expect(refreshed).not.toBeNull();
    expect(refreshed?.verifiedAt).toBe(now);
  });

  it('falls to full when cache is expired and version changed', async () => {
    const oldFixture = createSignedManifestFixture();
    const newFixture = createSignedManifestFixture({
      files: { 'assets/index.js': 'new content v2' },
    });
    const expiredTime = Date.now() - 25 * 60 * 60 * 1000;
    const cache = makeCache(oldFixture, { verifiedAt: expiredTime });
    writeCachedDigest(cache);

    const result = await tieredVerifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: createFetchWithHashStub(newFixture),
      publicKeyPem: newFixture.publicPem,
    });

    // Different manifest hash → Tier 2 hash mismatch → falls to full
    expect(result.tier).toBe('full');
    expect(result.result.status).toBe('verified');
  });

  it('falls to full when manifest hash hint disagrees with the cache', async () => {
    const fixture = createSignedManifestFixture();
    const cache = makeCache(fixture, { verifiedAt: Date.now() });
    writeCachedDigest(cache);

    const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/manifest-hash.txt')) {
        return new Response('different-hash-forces-cache-miss\n', { status: 200 });
      }
      return createFetchStub(fixture)(input, init);
    }) as typeof fetch;

    const result = await tieredVerifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: fetchStub,
      publicKeyPem: fixture.publicPem,
      nowMs: Date.now(),
    });

    expect(result.tier).toBe('full');
    expect(result.result.status).toBe('verified');
  });

  it('does not trust a fresh cache when signature re-validation fails', async () => {
    const fixture = createSignedManifestFixture();
    writeCachedDigest(makeCache(fixture, { verifiedAt: Date.now() }));

    const brokenFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/manifest-hash.txt')) {
        return createManifestHashResponse(fixture.manifestHash);
      }
      if (url.endsWith('/manifest.sig')) {
        return new Response('invalid-signature\n', { status: 200 });
      }
      return createFetchStub(fixture)(input, init);
    }) as typeof fetch;

    const result = await tieredVerifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: brokenFetch,
      publicKeyPem: fixture.publicPem,
    });

    expect(result.tier).toBe('full');
    expect(result.result.status).not.toBe('verified');
    expect(readCachedDigest()).toBeNull();
  });

  it('clears cache on verification failure', async () => {
    const fixture = createSignedManifestFixture();
    writeCachedDigest(makeCache(fixture));

    // Fetch that returns invalid signature
    const brokenFetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/manifest-hash.txt')) {
        return new Response('new-hash\n', { status: 200 });
      }
      if (url.endsWith('/manifest.sig')) {
        return new Response('invalid-signature\n', { status: 200 });
      }
      return createFetchStub(fixture)(input);
    }) as typeof fetch;

    const result = await tieredVerifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: brokenFetch,
      publicKeyPem: fixture.publicPem,
    });

    expect(result.tier).toBe('full');
    // The full verification will also fail because of the invalid signature
    expect(result.result.status).not.toBe('verified');
    expect(readCachedDigest()).toBeNull();
  });

  it('falls to full when manifest-hash.txt is unavailable', async () => {
    const fixture = createSignedManifestFixture();
    writeCachedDigest(makeCache(fixture));

    const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/manifest-hash.txt')) {
        return new Response('not found', { status: 404 });
      }
      return createFetchStub(fixture)(input, init);
    }) as typeof fetch;

    const result = await tieredVerifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: fetchStub,
      publicKeyPem: fixture.publicPem,
    });

    // Hash hint is unavailable, but signature-only re-validation still works.
    expect(result.result.status).toBe('verified');
  });

  it('handles localStorage being unavailable gracefully', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('localStorage disabled');
      },
      setItem: () => {
        throw new Error('localStorage disabled');
      },
      removeItem: () => {
        throw new Error('localStorage disabled');
      },
    });

    const fixture = createSignedManifestFixture();
    const result = await tieredVerifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: createFetchWithHashStub(fixture),
      publicKeyPem: fixture.publicPem,
    });

    expect(result.tier).toBe('full');
    expect(result.result.status).toBe('verified');
  });
});
