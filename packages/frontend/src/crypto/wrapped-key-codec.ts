import type { Base64Url, WrappedPrivateKey } from '@zerolink/shared';
import { AES_GCM, ARGON2ID } from '@zerolink/shared';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

function decodeBase64UrlLength(value: string): number {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const withPad = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  return atob(withPad).length;
}

/**
 * Serializes a WrappedPrivateKey into a compact dot-separated string:
 * `<encryptedKey>.<iv>.<salt>`
 *
 * KDF parameters are fixed protocol constants and are not serialized;
 * they are reconstructed from shared constants on deserialization.
 *
 * Throws if kdfType is not 'argon2id'.
 */
export function serializeWrappedKeyCompact(wk: WrappedPrivateKey): string {
  if (wk.kdf.kdfType !== 'argon2id') {
    throw new Error(`Unsupported kdfType for compact serialization: ${wk.kdf.kdfType}`);
  }
  return `${wk.encryptedKey}.${wk.iv}.${wk.kdf.salt}`;
}

/**
 * Deserializes a compact dot-separated string back into a WrappedPrivateKey.
 *
 * Returns null if the input is malformed, contains non-base64url characters,
 * or if IV/salt decode to the wrong byte length.
 */
export function deserializeWrappedKeyCompact(compact: string): WrappedPrivateKey | null {
  const parts = compact.split('.');
  if (parts.length !== 3) return null;

  const [encryptedKey, iv, salt] = parts as [string, string, string];

  if (!encryptedKey) return null;

  for (const part of [encryptedKey, iv, salt]) {
    if (!BASE64URL_PATTERN.test(part)) return null;
  }

  if (decodeBase64UrlLength(iv) !== AES_GCM.IV_LENGTH) return null;
  if (decodeBase64UrlLength(salt) !== ARGON2ID.SALT_LENGTH) return null;

  return {
    encryptedKey: encryptedKey as Base64Url,
    iv: iv as Base64Url,
    kdf: {
      kdfType: 'argon2id',
      version: 19,
      m: ARGON2ID.MEMORY_COST_KB,
      t: ARGON2ID.TIME_COST,
      p: ARGON2ID.PARALLELISM,
      salt: salt as Base64Url,
    },
  };
}
