import { createHash, createPrivateKey, generateKeyPairSync, sign as signData } from 'node:crypto';

import type { ReleaseManifest } from '../release/manifest';

export type MockFetch = typeof fetch;

type SignedManifestFixtureOptions = {
  files?: Record<string, string>;
  entryAssetPath?: string;
};

const DEFAULT_FILES = {
  'assets/index.css': '.app { color: white; }',
  'assets/index.js': 'console.log("verified");',
  'assets/chunk-vendor.js': 'export const vendor = "stable-runtime";',
  'assets/sora-latin.woff2': 'fake-font-binary',
} as const;

export function signManifest(manifest: ReleaseManifest, privatePem: string): string {
  return signData(
    null,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    createPrivateKey(privatePem)
  )
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function createSignedManifestFixture(options: SignedManifestFixtureOptions = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const files = options.files ?? DEFAULT_FILES;
  const entryAssetPath = options.entryAssetPath ?? 'assets/index.js';
  const manifest = {
    version: '1.2.3',
    commitHash: 'abc1234',
    buildTime: '2026-03-08T12:34:56.000Z',
    entryAssetPath,
    files: Object.fromEntries(
      Object.entries(files).map(([relativePath, content]) => [
        relativePath,
        createHash('sha256').update(content, 'utf8').digest('hex'),
      ])
    ),
  } satisfies ReleaseManifest;
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  return {
    files,
    manifest,
    manifestHash: createHash('sha256').update(manifestJson, 'utf8').digest('hex'),
    manifestJson,
    privatePem,
    publicPem,
    signature: signManifest(manifest, privatePem),
  };
}

export function createFetchStub(fixture: {
  files: Record<string, string>;
  manifestJson: string;
  signature: string;
}): MockFetch {
  return (async (input: RequestInfo | URL) => {
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
