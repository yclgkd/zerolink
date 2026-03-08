import { createHash, createPrivateKey, generateKeyPairSync, sign as signData } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  computePublicKeyFingerprint,
  pemToSpkiBytes,
  verifyRelease,
} from '../release/verification';

type MockFetch = typeof fetch;

function createSignedManifestFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const files = {
    'assets/index.css': '.app { color: white; }',
    'assets/index.js': 'console.log("verified");',
    'index.html':
      '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>',
    'mockServiceWorker.js': 'self.addEventListener("install", () => {});',
  } as const;

  const manifest = {
    version: '1.2.3',
    commitHash: 'abc1234',
    buildTime: '2026-03-08T12:34:56.000Z',
    files: Object.fromEntries(
      Object.entries(files).map(([relativePath, content]) => [
        relativePath,
        createHash('sha256').update(content, 'utf8').digest('hex'),
      ])
    ),
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const signature = signData(null, Buffer.from(manifestJson, 'utf8'), createPrivateKey(privatePem))
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');

  return {
    files,
    manifest,
    manifestHash: createHash('sha256').update(manifestJson, 'utf8').digest('hex'),
    manifestJson,
    privatePem,
    publicPem,
    signature,
  };
}

type ReleaseFetchFixture = {
  files: Record<string, string>;
  manifestJson: string;
  signature: string;
};

function createFetchStub(fixture: ReleaseFetchFixture): MockFetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/manifest.json')) {
      return new Response(fixture.manifestJson, {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }
    if (url.endsWith('/manifest.sig')) {
      return new Response(`${fixture.signature}\n`, { status: 200 });
    }

    const pathname = new URL(url, 'https://zerolink.test').pathname.slice(1);
    const fileContent = fixture.files[pathname as keyof typeof fixture.files];
    if (typeof fileContent === 'string') {
      return new Response(fileContent, { status: 200 });
    }

    return new Response('not found', { status: 404 });
  }) as MockFetch;
}

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
  it('returns verified details when signature and all release file hashes match', async () => {
    const fixture = createSignedManifestFixture();
    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
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
    const fetchImpl = createFetchStub({
      ...fixture,
      signature: `${fixture.signature.slice(0, -1)}A`,
    });

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
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
          '../secrets.txt': fixture.manifest.files['assets/index.js'] ?? 'deadbeef',
        },
      },
    };
    const manifestJson = `${JSON.stringify(compromised.manifest, null, 2)}\n`;
    const signature = signData(
      null,
      Buffer.from(manifestJson, 'utf8'),
      createPrivateKey(fixture.privatePem)
    );
    const fetchImpl = createFetchStub({
      ...compromised,
      manifestJson,
      signature: signature
        .toString('base64')
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, ''),
    });

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      fetchImpl,
      publicKeyPem: fixture.publicPem,
    });

    expect(result).toEqual({
      detail: 'Signed manifest entry "../secrets.txt" is not a safe same-origin release path.',
      reason: 'invalid_manifest_path',
      status: 'failed',
    });
  });

  it('returns unavailable when the environment cannot import an Ed25519 public key', async () => {
    const fixture = createSignedManifestFixture();
    const importKey = vi
      .spyOn(crypto.subtle, 'importKey')
      .mockRejectedValueOnce(new DOMException('Ed25519 is unsupported', 'NotSupportedError'));

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      fetchImpl: createFetchStub(fixture),
      publicKeyPem: fixture.publicPem,
    });

    expect(importKey).toHaveBeenCalled();
    expect(result).toEqual({
      detail: 'This browser cannot import the embedded publisher key for Ed25519 verification.',
      reason: 'crypto_unavailable',
      status: 'unavailable',
    });
  });
});
