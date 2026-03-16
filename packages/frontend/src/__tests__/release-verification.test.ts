import { afterEach, describe, expect, it, vi } from 'vitest';
import * as cryptoModule from '../release/crypto';
import {
  computePublicKeyFingerprint,
  pemToSpkiBytes,
  verifyRelease,
} from '../release/verification';
import {
  createFetchStub,
  createSignedManifestFixture,
  type MockFetch,
  signManifest,
} from './release-verification-test-helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pemToSpkiBytes', () => {
  it('parses PEM-encoded Ed25519 public keys into DER bytes', () => {
    const { publicPem } = createSignedManifestFixture();
    const bytes = pemToSpkiBytes(publicPem);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

describe('computePublicKeyFingerprint', () => {
  it('returns a stable SHA-256 fingerprint for the signing key', async () => {
    const { publicPem } = createSignedManifestFixture();
    const fingerprint = await computePublicKeyFingerprint(publicPem);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('verifyRelease', () => {
  it('returns verified details when signature and all signed runtime asset hashes match', async () => {
    const fixture = createSignedManifestFixture();
    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: createFetchStub(fixture),
      publicKeyPem: fixture.publicPem,
    });

    expect(result.status).toBe('verified');
    if (result.status !== 'verified') {
      throw new Error('expected verified result');
    }
    expect(result.version).toBe('1.2.3');
    expect(result.commitHash).toBe('abc1234');
    expect(result.manifestHash).toBe(fixture.manifestHash);
    expect(result.verifiedFileCount).toBe(Object.keys(fixture.files).length);
    expect(result.signature).toBe(fixture.signature);
    expect(result.publicKeyFingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('fails closed when the manifest signature is invalid', async () => {
    const fixture = createSignedManifestFixture();
    // Corrupt the first character (full 6 data bits) to guarantee decoded bytes change.
    // Corrupting the last character is unreliable: for a 64-byte Ed25519 sig, only the
    // upper 2 bits of the last base64url char carry data; if those bits are already 0,
    // replacing with 'A' (= 0) is a no-op that leaves the decoded signature unchanged.
    const firstChar = fixture.signature[0];
    const corruptedFirstChar = firstChar !== 'A' ? 'A' : 'B';
    const fetchImpl = createFetchStub({
      ...fixture,
      signature: `${corruptedFirstChar}${fixture.signature.slice(1)}`,
    });

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl,
      publicKeyPem: fixture.publicPem,
    });

    expect(result).toEqual({
      detail: 'Manifest signature did not validate against the embedded publisher key.',
      reason: 'signature_invalid',
      status: 'failed',
    });
  });

  it('fails closed when any signed asset is missing', async () => {
    const fixture = createSignedManifestFixture();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/assets/index.js')) {
        return new Response('not found', { status: 404 });
      }
      return createFetchStub(fixture)(input);
    }) as MockFetch;

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl,
      publicKeyPem: fixture.publicPem,
    });

    expect(result).toEqual({
      detail: 'Signed asset "assets/index.js" could not be fetched for verification.',
      reason: 'asset_missing',
      status: 'failed',
    });
  });

  it('rejects path traversal entries in the signed manifest', async () => {
    const fixture = createSignedManifestFixture();
    const compromised = {
      ...fixture,
      manifest: {
        ...fixture.manifest,
        files: {
          [fixture.manifest.entryAssetPath]:
            fixture.manifest.files[fixture.manifest.entryAssetPath] ?? 'deadbeef',
          '../secrets.txt': fixture.manifest.files['assets/index.js'] ?? 'deadbeef',
        },
      },
    };
    const manifestJson = `${JSON.stringify(compromised.manifest, null, 2)}\n`;
    const fetchImpl = createFetchStub({
      ...compromised,
      manifestJson,
      signature: signManifest(compromised.manifest, fixture.privatePem),
    });

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl,
      publicKeyPem: fixture.publicPem,
    });

    expect(result).toEqual({
      detail: 'Signed manifest entry "../secrets.txt" is not a safe same-origin release path.',
      reason: 'invalid_manifest_path',
      status: 'failed',
    });
  });

  it('returns crypto_unavailable when all Ed25519 verification paths are unavailable', async () => {
    const fixture = createSignedManifestFixture();
    vi.spyOn(cryptoModule, 'verifyManifestSignature').mockRejectedValue(
      new Error('Both native and noble Ed25519 paths are unavailable')
    );

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: createFetchStub(fixture),
      publicKeyPem: fixture.publicPem,
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('expected unavailable');
    expect(result.reason).toBe('crypto_unavailable');
  });
});
