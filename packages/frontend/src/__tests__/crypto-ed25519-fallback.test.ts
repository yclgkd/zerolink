import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  pemToSpkiBytes,
  resetProbeCache,
  spkiToRawEd25519,
  verifyManifestSignature,
} from '../release/crypto';
import { verifyRelease } from '../release/verification';
import { createFetchStub, createSignedManifestFixture } from './release-verification-test-helpers';

// ─── spkiToRawEd25519 ─────────────────────────────────────────────────────────

describe('spkiToRawEd25519', () => {
  it('extracts the 32-byte raw key from a valid Ed25519 SPKI byte array', () => {
    const { publicPem } = createSignedManifestFixture();
    const spkiBytes = pemToSpkiBytes(publicPem);
    const raw = spkiToRawEd25519(spkiBytes);
    expect(raw.byteLength).toBe(32);
  });

  it('throws when input length is not 44 bytes', () => {
    expect(() => spkiToRawEd25519(new Uint8Array(10))).toThrow(/Ed25519 SPKI/u);
  });

  it('throws when the SPKI header does not match Ed25519', () => {
    const wrongHeader = new Uint8Array(44).fill(0); // all zeros – invalid prefix
    expect(() => spkiToRawEd25519(wrongHeader)).toThrow(/Ed25519 SPKI/u);
  });
});

// ─── Native path (probe succeeds) ────────────────────────────────────────────

describe('verifyManifestSignature – native WebCrypto path', () => {
  afterEach(() => {
    resetProbeCache();
    vi.restoreAllMocks();
  });

  it('uses crypto.subtle.verify when native Ed25519 is supported', async () => {
    const { publicPem, manifestJson, signature } = createSignedManifestFixture();
    const verifySpy = vi.spyOn(crypto.subtle, 'verify');

    const result = await verifyManifestSignature({
      manifestBytes: new TextEncoder().encode(manifestJson),
      publicKeyPem: publicPem,
      signatureBase64Url: signature,
    });

    expect(result).toBe(true);
    expect(verifySpy).toHaveBeenCalled();
  });

  it('returns false (not throws) for an invalid signature on the native path', async () => {
    const { publicPem, manifestJson, signature } = createSignedManifestFixture();
    const firstChar = signature[0];
    const corrupted = (firstChar !== 'A' ? 'A' : 'B') + signature.slice(1);

    const result = await verifyManifestSignature({
      manifestBytes: new TextEncoder().encode(manifestJson),
      publicKeyPem: publicPem,
      signatureBase64Url: corrupted,
    });

    expect(result).toBe(false);
  });

  it('memoizes the probe so importKey is called only once across multiple calls', async () => {
    const { publicPem, manifestJson, signature } = createSignedManifestFixture();
    const importKeySpy = vi.spyOn(crypto.subtle, 'importKey');

    await verifyManifestSignature({
      manifestBytes: new TextEncoder().encode(manifestJson),
      publicKeyPem: publicPem,
      signatureBase64Url: signature,
    });
    await verifyManifestSignature({
      manifestBytes: new TextEncoder().encode(manifestJson),
      publicKeyPem: publicPem,
      signatureBase64Url: signature,
    });

    // Without memoization: 2 probes + 2 verifies = 4 importKey calls
    // With memoization:    1 probe  + 2 verifies = 3 importKey calls
    expect(importKeySpy).toHaveBeenCalledTimes(3);
  });
});

// ─── Noble fallback path (probe fails) ───────────────────────────────────────

describe('verifyManifestSignature – @noble/ed25519 fallback path', () => {
  beforeEach(() => {
    resetProbeCache();
    // Block Ed25519 importKey so the probe fails and triggers the noble fallback.
    // Noble does not call importKey, so rejecting all importKey calls is safe here.
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(
      new DOMException('Ed25519 is unsupported', 'NotSupportedError')
    );
  });

  afterEach(() => {
    resetProbeCache();
    vi.restoreAllMocks();
  });

  it('returns true when noble fallback verifies a valid signature', async () => {
    const { publicPem, manifestJson, signature } = createSignedManifestFixture();

    const result = await verifyManifestSignature({
      manifestBytes: new TextEncoder().encode(manifestJson),
      publicKeyPem: publicPem,
      signatureBase64Url: signature,
    });

    expect(result).toBe(true);
  });

  it('returns false (not throws) when noble fallback encounters a bad signature', async () => {
    const { publicPem, manifestJson, signature } = createSignedManifestFixture();
    const firstChar = signature[0];
    const corrupted = (firstChar !== 'A' ? 'A' : 'B') + signature.slice(1);

    const result = await verifyManifestSignature({
      manifestBytes: new TextEncoder().encode(manifestJson),
      publicKeyPem: publicPem,
      signatureBase64Url: corrupted,
    });

    expect(result).toBe(false);
  });

  it('returns false (not throws) when noble receives a malformed signature (wrong byte length)', async () => {
    const { publicPem, manifestJson } = createSignedManifestFixture();
    // 'AAAA' decodes to only 3 bytes – far too short for a 64-byte Ed25519 signature
    const malformed = 'AAAA';

    const result = await verifyManifestSignature({
      manifestBytes: new TextEncoder().encode(manifestJson),
      publicKeyPem: publicPem,
      signatureBase64Url: malformed,
    });

    expect(result).toBe(false);
  });

  it('does not call crypto.subtle.verify (uses noble instead)', async () => {
    const { publicPem, manifestJson, signature } = createSignedManifestFixture();
    const verifySpy = vi.spyOn(crypto.subtle, 'verify');

    await verifyManifestSignature({
      manifestBytes: new TextEncoder().encode(manifestJson),
      publicKeyPem: publicPem,
      signatureBase64Url: signature,
    });

    expect(verifySpy).not.toHaveBeenCalled();
  });
});

// ─── Business failures not masked by noble fallback ───────────────────────────

describe('verifyRelease – business failures not masked by noble fallback', () => {
  beforeEach(() => {
    resetProbeCache();
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(
      new DOMException('Ed25519 is unsupported', 'NotSupportedError')
    );
  });

  afterEach(() => {
    resetProbeCache();
    vi.restoreAllMocks();
  });

  it('returns manifest_unavailable when manifest cannot be fetched', async () => {
    const fixture = createSignedManifestFixture();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/manifest.json')) return new Response('', { status: 503 });
      return createFetchStub(fixture)(input);
    }) as typeof fetch;

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl,
      publicKeyPem: fixture.publicPem,
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('expected unavailable');
    expect(result.reason).toBe('manifest_unavailable');
  });

  it('returns manifest_invalid when manifest JSON is malformed', async () => {
    const fixture = createSignedManifestFixture();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/manifest.json')) return new Response('not-json', { status: 200 });
      return createFetchStub(fixture)(input);
    }) as typeof fetch;

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl,
      publicKeyPem: fixture.publicPem,
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('expected unavailable');
    expect(result.reason).toBe('manifest_invalid');
  });

  it('returns entry_asset_mismatch when running bundle does not match signed manifest', async () => {
    const fixture = createSignedManifestFixture();

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index-stale.js',
      fetchImpl: createFetchStub(fixture),
      publicKeyPem: fixture.publicPem,
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('expected failed');
    expect(result.reason).toBe('entry_asset_mismatch');
  });
});
