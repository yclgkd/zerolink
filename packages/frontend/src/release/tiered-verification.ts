import { sha256Hex } from './crypto';
import type {
  ReleaseVerificationResult,
  VerifiedReleaseSnapshot,
  VerifyReleaseOptions,
} from './verification';
import { verifyRelease } from './verification';

// ─── Cache Types ─────────────────────────────────────────────────────────────

export interface TrustedDigestCache {
  readonly manifestHash: string;
  readonly version: string;
  readonly publicKeyFingerprint: string;
  readonly verifiedAt: number;
  readonly snapshot: VerifiedReleaseSnapshot;
}

export type TieredVerificationTier = 'signature_only' | 'full';

export interface TieredVerificationResult {
  readonly tier: TieredVerificationTier;
  readonly result: ReleaseVerificationResult;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_KEY = 'zerolink:trusted-manifest-digest';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Storage Helpers ─────────────────────────────────────────────────────────

export function readCachedDigest(): TrustedDigestCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidCache(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedDigest(cache: TrustedDigestCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be full or disabled — non-critical
  }
}

export function clearCachedDigest(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // non-critical
  }
}

function isValidCache(value: unknown): value is TrustedDigestCache {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['manifestHash'] === 'string' &&
    typeof obj['version'] === 'string' &&
    typeof obj['publicKeyFingerprint'] === 'string' &&
    typeof obj['verifiedAt'] === 'number' &&
    typeof obj['snapshot'] === 'object' &&
    obj['snapshot'] !== null &&
    (obj['snapshot'] as Record<string, unknown>)['status'] === 'verified'
  );
}

// ─── Fetch Helpers ───────────────────────────────────────────────────────────

async function fetchManifestHash(baseUrl: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(new URL('manifest-hash.txt', baseUrl).href, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.trim() || null;
  } catch {
    return null;
  }
}

async function fetchManifestText(baseUrl: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(new URL('manifest.json', baseUrl).href, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

async function fetchSignatureText(
  baseUrl: string,
  fetchImpl: typeof fetch
): Promise<string | null> {
  try {
    const response = await fetchImpl(new URL('manifest.sig', baseUrl).href, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

// ─── Signature-only verification ─────────────────────────────────────────────

async function verifySignatureOnly(
  baseUrl: string,
  publicKeyPem: string,
  fetchImpl: typeof fetch
): Promise<{ manifestHash: string; manifestText: string } | null> {
  const [manifestText, signatureText] = await Promise.all([
    fetchManifestText(baseUrl, fetchImpl),
    fetchSignatureText(baseUrl, fetchImpl),
  ]);
  if (!manifestText || !signatureText) return null;

  try {
    const { verifyManifestSignature } = await import('./crypto');
    const valid = await verifyManifestSignature({
      manifestBytes: new TextEncoder().encode(manifestText),
      publicKeyPem,
      signatureBase64Url: signatureText.trim(),
    });
    if (!valid) return null;

    const manifestHash = await sha256Hex(new TextEncoder().encode(manifestText));
    return { manifestHash, manifestText };
  } catch {
    return null;
  }
}

// ─── Tiered Verification ─────────────────────────────────────────────────────

export interface TieredVerifyOptions extends VerifyReleaseOptions {
  readonly nowMs?: number;
}

export async function tieredVerifyRelease(
  options: TieredVerifyOptions
): Promise<TieredVerificationResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.nowMs ?? Date.now();
  const baseUrl = new URL('/', options.baseUrl).href;

  const cached = readCachedDigest();
  const cacheIsFresh = cached ? now - cached.verifiedAt <= CACHE_TTL_MS : false;
  const remoteHashHint =
    cached && cacheIsFresh ? await fetchManifestHash(baseUrl, fetchImpl) : null;

  // `manifest-hash.txt` is a freshness hint only. Reuse cached trust only after
  // re-validating the signed manifest bytes and detached signature.
  const shouldAttemptSignatureOnly =
    cached !== null && (remoteHashHint === null || remoteHashHint === cached.manifestHash);

  if (shouldAttemptSignatureOnly && cached) {
    const sigResult = await verifySignatureOnly(baseUrl, options.publicKeyPem, fetchImpl);
    if (sigResult && sigResult.manifestHash === cached.manifestHash) {
      const refreshedCache: TrustedDigestCache = {
        ...cached,
        verifiedAt: now,
      };
      writeCachedDigest(refreshedCache);
      return {
        tier: 'signature_only',
        result: cached.snapshot,
      };
    }
  }

  // ── Full verification ───────────────────────────────────────────────────────
  const verifyOptions = {
    baseUrl: options.baseUrl,
    currentEntryUrl: options.currentEntryUrl,
    publicKeyPem: options.publicKeyPem,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  const fullResult = await verifyRelease(verifyOptions);

  if (fullResult.status === 'verified') {
    const newCache: TrustedDigestCache = {
      manifestHash: fullResult.manifestHash,
      publicKeyFingerprint: fullResult.publicKeyFingerprint,
      snapshot: fullResult,
      verifiedAt: now,
      version: fullResult.version,
    };
    writeCachedDigest(newCache);
  } else {
    // Verification failed → clear any stale cache
    clearCachedDigest();
  }

  return {
    tier: 'full',
    result: fullResult,
  };
}
