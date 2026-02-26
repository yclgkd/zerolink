import { type Base64Url, DOMAIN, type HexString, LOCK_SECRET_BYTES } from '@zerolink/shared';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

function getCryptoApi(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('WebCrypto is not available');
  }
  return cryptoApi;
}

function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToBinary(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return binary;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): Base64Url {
  return btoa(bytesToBinary(bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '') as Base64Url;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error('invalid base64url');
  }

  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return binaryToBytes(atob(padded));
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function sha256Bytes(chunks: readonly Uint8Array[]): Promise<Uint8Array> {
  const digest = await getCryptoApi().subtle.digest('SHA-256', toArrayBuffer(concatBytes(chunks)));
  return new Uint8Array(digest);
}

async function sha256Hex(chunks: readonly Uint8Array[]): Promise<HexString> {
  const digest = await sha256Bytes(chunks);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') as HexString;
}

/**
 * Generates a base64url lock secret for share-link fragment usage.
 */
export function generateLockSecretB64u(): Base64Url {
  return encodeBase64Url(getCryptoApi().getRandomValues(new Uint8Array(LOCK_SECRET_BYTES)));
}

/**
 * Derives lock key from domain + uuid + lock secret.
 */
export async function deriveLockKeyB64u(uuid: string, lockSecretB64u: string): Promise<Base64Url> {
  return encodeBase64Url(
    await sha256Bytes([
      toUtf8Bytes(DOMAIN.LOCK_KEY),
      toUtf8Bytes(uuid),
      decodeBase64Url(lockSecretB64u),
    ])
  );
}

export interface DeriveLockProofInput {
  uuid: string;
  lockChallengeId: string;
  lockChallenge: string;
  lockKeyB64u: string;
}

/**
 * Derives lock proof hex from lock challenge and lock key.
 */
export async function deriveLockProofHex({
  uuid,
  lockChallengeId,
  lockChallenge,
  lockKeyB64u,
}: DeriveLockProofInput): Promise<HexString> {
  return sha256Hex([
    toUtf8Bytes(DOMAIN.LOCK_PROOF),
    toUtf8Bytes(uuid),
    decodeBase64Url(lockChallengeId),
    decodeBase64Url(lockChallenge),
    decodeBase64Url(lockKeyB64u),
  ]);
}

export interface DeriveExpectedCompoundChallengeInput {
  uuid: string;
  challengeId: string;
  challengeSeed: string;
  intentHash: string;
}

/**
 * Derives expected WebAuthn challenge for compound commit flow.
 */
export async function deriveExpectedCompoundChallengeB64u({
  uuid,
  challengeId,
  challengeSeed,
  intentHash,
}: DeriveExpectedCompoundChallengeInput): Promise<Base64Url> {
  return encodeBase64Url(
    await sha256Bytes([
      toUtf8Bytes(DOMAIN.CHALLENGE),
      toUtf8Bytes(uuid),
      decodeBase64Url(challengeId),
      toUtf8Bytes(intentHash),
      decodeBase64Url(challengeSeed),
    ])
  );
}

/**
 * Builds share URL with lock secret in hash fragment.
 */
export function buildShareUrlWithFragment(shareUrl: string, lockSecretB64u: string): string {
  const hash = `k=${encodeURIComponent(lockSecretB64u)}`;
  const hashIndex = shareUrl.indexOf('#');
  const base = hashIndex >= 0 ? shareUrl.slice(0, hashIndex) : shareUrl;
  return `${base}#${hash}`;
}

/**
 * Extracts lock secret from a hash string like "#k=...".
 */
export function extractLockSecretFromHash(hash: string): Base64Url | null {
  const normalized = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(normalized);
  const value = params.get('k');
  if (!value || !BASE64URL_PATTERN.test(value)) {
    return null;
  }
  return value as Base64Url;
}

/**
 * Computes SHA-256 hex for arbitrary bytes.
 */
export async function computeSha256Hex(bytes: Uint8Array): Promise<HexString> {
  return sha256Hex([bytes]);
}

/**
 * Decodes base64url bytes for crypto pipelines.
 */
export function decodeBase64UrlBytes(value: string): Uint8Array {
  return decodeBase64Url(value);
}

/**
 * Encodes bytes as base64url for transport payloads.
 */
export function encodeBase64UrlBytes(value: Uint8Array): Base64Url {
  return encodeBase64Url(value);
}
