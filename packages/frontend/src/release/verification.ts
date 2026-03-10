import { computePublicKeyFingerprint, sha256Hex, verifyManifestSignature } from './crypto';
import { isSafeManifestPath, normalizeBaseUrl, parseManifest, toReleasePath } from './manifest';

export { computePublicKeyFingerprint, pemToSpkiBytes } from './crypto';

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
  reason:
    | 'signature_invalid'
    | 'asset_missing'
    | 'asset_hash_mismatch'
    | 'invalid_manifest_path'
    | 'entry_asset_mismatch';
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
  currentEntryUrl: string;
  fetchImpl?: typeof fetch;
  publicKeyPem: string;
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

  const currentEntryPath = toReleasePath(options.currentEntryUrl, baseUrl);
  if (currentEntryPath === null || currentEntryPath !== manifest.entryAssetPath) {
    return {
      detail: 'The running bootstrap entry asset does not match the signed release manifest entry.',
      reason: 'entry_asset_mismatch',
      status: 'failed',
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
