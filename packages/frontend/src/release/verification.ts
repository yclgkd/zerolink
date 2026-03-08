export interface ReleaseManifest {
  version: string;
  commitHash: string;
  buildTime: string;
  files: Record<string, string>;
}

export interface VerifiedReleaseSnapshot {
  status: 'verified';
  version: string;
  commitHash: string;
  buildTime: string;
  manifestHash: string;
  verifiedFileCount: number;
  signature: string;
  publicKeyFingerprint: string;
}

export interface ReleaseVerificationFailure {
  status: 'failed';
  reason: 'signature_invalid' | 'asset_missing' | 'asset_hash_mismatch' | 'invalid_manifest_path';
  detail: string;
}

export interface ReleaseVerificationUnavailable {
  status: 'unavailable';
  reason:
    | 'crypto_unavailable'
    | 'manifest_unavailable'
    | 'manifest_invalid'
    | 'signature_unavailable';
  detail: string;
}

export type ReleaseVerificationResult =
  | VerifiedReleaseSnapshot
  | ReleaseVerificationFailure
  | ReleaseVerificationUnavailable;

export interface VerifyReleaseOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  publicKeyPem: string;
}

function decodeBase64(base64: string): Uint8Array {
  const normalized = atob(base64);
  return Uint8Array.from(normalized, (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return decodeBase64(normalized);
}

export function pemToSpkiBytes(publicKeyPem: string): Uint8Array {
  const base64 = publicKeyPem
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/gu, '')
    .replace(/\s+/gu, '');
  return decodeBase64(base64);
}

async function sha256Hex(input: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyManifestSignature(opts: {
  manifestBytes: Uint8Array;
  publicKeyPem: string;
  signatureBase64Url: string;
}): Promise<boolean> {
  const { manifestBytes, publicKeyPem, signatureBase64Url } = opts;
  const publicKey = await crypto.subtle.importKey(
    'spki',
    toArrayBuffer(pemToSpkiBytes(publicKeyPem)),
    { name: 'Ed25519' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    toArrayBuffer(base64UrlToBytes(signatureBase64Url)),
    toArrayBuffer(manifestBytes)
  );
}

export async function computePublicKeyFingerprint(publicKeyPem: string): Promise<string> {
  return sha256Hex(pemToSpkiBytes(publicKeyPem));
}

function isSafeManifestPath(relativePath: string): boolean {
  if (!/^[A-Za-z0-9._/-]+$/u.test(relativePath)) {
    return false;
  }
  if (
    relativePath.startsWith('/') ||
    relativePath.startsWith('./') ||
    relativePath.includes('//')
  ) {
    return false;
  }
  const segments = relativePath.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function normalizeBaseUrl(baseUrl: string): string {
  return new URL('/', baseUrl).href;
}

function parseManifest(rawManifest: string): ReleaseManifest | null {
  const parsed = JSON.parse(rawManifest) as Partial<ReleaseManifest>;
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    return null;
  }
  if (typeof parsed.commitHash !== 'string' || parsed.commitHash.length === 0) {
    return null;
  }
  if (typeof parsed.buildTime !== 'string' || Number.isNaN(Date.parse(parsed.buildTime))) {
    return null;
  }
  if (!parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
    return null;
  }

  const files = Object.entries(parsed.files).every(
    ([relativePath, hash]) =>
      typeof relativePath === 'string' && /^[0-9a-f]{64}$/u.test(String(hash))
  );
  if (!files) {
    return null;
  }

  return parsed as ReleaseManifest;
}

async function fetchText(fetchImpl: typeof fetch, url: string): Promise<string | null> {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) {
    return null;
  }
  return response.text();
}

async function fetchBytes(fetchImpl: typeof fetch, url: string): Promise<Uint8Array | null> {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) {
    return null;
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function verifyRelease(
  options: VerifyReleaseOptions
): Promise<ReleaseVerificationResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  const [manifestText, signatureText] = await Promise.all([
    fetchText(fetchImpl, new URL('manifest.json', baseUrl).href),
    fetchText(fetchImpl, new URL('manifest.sig', baseUrl).href),
  ]);

  if (manifestText === null) {
    return {
      detail: 'Signed release metadata could not be loaded from this deployment.',
      reason: 'manifest_unavailable',
      status: 'unavailable',
    };
  }
  if (signatureText === null) {
    return {
      detail: 'Signed release metadata is missing its detached signature.',
      reason: 'signature_unavailable',
      status: 'unavailable',
    };
  }

  const manifest = parseManifest(manifestText);
  if (!manifest) {
    return {
      detail: 'Signed release metadata is not a valid ZeroLink manifest payload.',
      reason: 'manifest_invalid',
      status: 'unavailable',
    };
  }

  try {
    const signatureValid = await verifyManifestSignature({
      manifestBytes: new TextEncoder().encode(manifestText),
      publicKeyPem: options.publicKeyPem,
      signatureBase64Url: signatureText.trim(),
    });
    if (!signatureValid) {
      return {
        detail: 'Manifest signature did not validate against the embedded publisher key.',
        reason: 'signature_invalid',
        status: 'failed',
      };
    }
  } catch {
    return {
      detail: 'This browser cannot import the embedded publisher key for Ed25519 verification.',
      reason: 'crypto_unavailable',
      status: 'unavailable',
    };
  }

  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    if (!isSafeManifestPath(relativePath)) {
      return {
        detail: `Signed manifest entry "${relativePath}" is not a safe same-origin release path.`,
        reason: 'invalid_manifest_path',
        status: 'failed',
      };
    }

    const assetUrl = new URL(relativePath, baseUrl);
    if (assetUrl.origin !== new URL(baseUrl).origin) {
      return {
        detail: `Signed manifest entry "${relativePath}" escaped the deployment origin.`,
        reason: 'invalid_manifest_path',
        status: 'failed',
      };
    }

    const assetBytes = await fetchBytes(fetchImpl, assetUrl.href);
    if (assetBytes === null) {
      return {
        detail: `Signed asset "${relativePath}" could not be fetched for verification.`,
        reason: 'asset_missing',
        status: 'failed',
      };
    }

    const actualHash = await sha256Hex(assetBytes);
    if (actualHash !== expectedHash) {
      return {
        detail: `Signed asset "${relativePath}" did not match the published release hash.`,
        reason: 'asset_hash_mismatch',
        status: 'failed',
      };
    }
  }

  return {
    buildTime: manifest.buildTime,
    commitHash: manifest.commitHash,
    manifestHash: await sha256Hex(new TextEncoder().encode(manifestText)),
    publicKeyFingerprint: await computePublicKeyFingerprint(options.publicKeyPem),
    signature: signatureText.trim(),
    status: 'verified',
    verifiedFileCount: Object.keys(manifest.files).length,
    version: manifest.version,
  };
}
