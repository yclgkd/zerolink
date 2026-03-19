import { argon2idAsync } from '@noble/hashes/argon2.js';

import { AES_GCM, ARGON2ID, ECDSA, RSA_OAEP } from '../constants.ts';
import type { Argon2idParams, Base64Url, WrappedPrivateKey } from '../types.ts';
import { toBufferSource, wipeBytes } from './aes.ts';

const ARGON2_VERSION = 19 as const;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export interface WrapPrivateKeyParams {
  privateKey: CryptoKey;
  password: string;
  kdfParams?: Argon2idKdfParams | undefined;
}

export interface UnwrapPrivateKeyParams {
  wrapped: WrappedPrivateKey;
  password: string;
  kdfParams?: Argon2idKdfParams | undefined;
}

export interface Argon2idKdfParams {
  m: number;
  t: number;
  p: number;
  version?: 19 | undefined;
}

interface ResolvedArgon2idKdfParams {
  m: number;
  t: number;
  p: number;
  version: 19;
}

interface DeriveArgon2idKeyParams {
  password: string;
  salt: Uint8Array;
  m: number;
  t: number;
  p: number;
  version: number;
}

function resolveArgon2idKdfParams(kdfParams?: Argon2idKdfParams): ResolvedArgon2idKdfParams {
  return {
    m: kdfParams?.m ?? ARGON2ID.MEMORY_COST_KB,
    t: kdfParams?.t ?? ARGON2ID.TIME_COST,
    p: kdfParams?.p ?? ARGON2ID.PARALLELISM,
    version: kdfParams?.version ?? ARGON2_VERSION,
  };
}

function getCryptoApi(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('WebCrypto is not available');
  }
  return cryptoApi;
}

function assertPassword(password: string): void {
  if (password.length === 0) {
    throw new Error('password must not be empty');
  }
}

function assertIvLength(iv: Uint8Array): void {
  if (iv.byteLength !== AES_GCM.IV_LENGTH) {
    throw new Error('invalid wrapped private key IV length');
  }
}

function assertSaltLength(salt: Uint8Array): void {
  if (salt.byteLength !== ARGON2ID.SALT_LENGTH) {
    throw new Error('invalid wrapped private key salt length');
  }
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

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
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
    throw new Error('invalid base64url string');
  }

  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

  return binaryToBytes(atob(padded));
}

async function deriveArgon2idAesKey({
  password,
  salt,
  m,
  t,
  p,
  version,
}: DeriveArgon2idKeyParams): Promise<CryptoKey> {
  const cryptoApi = getCryptoApi();
  const keyMaterial = await argon2idAsync(password, salt, {
    m,
    t,
    p,
    version,
    dkLen: ARGON2ID.HASH_LENGTH,
  });

  try {
    return await cryptoApi.subtle.importKey(
      'raw',
      toBufferSource(keyMaterial),
      { name: AES_GCM.ALGORITHM_NAME },
      false,
      ['encrypt', 'decrypt']
    );
  } finally {
    wipeBytes(keyMaterial);
  }
}

export async function wrapPrivateKey({
  privateKey,
  password,
  kdfParams,
}: WrapPrivateKeyParams): Promise<WrappedPrivateKey> {
  const cryptoApi = getCryptoApi();
  assertPassword(password);
  const resolvedKdfParams = resolveArgon2idKdfParams(kdfParams);

  try {
    const salt = cryptoApi.getRandomValues(new Uint8Array(ARGON2ID.SALT_LENGTH));
    const iv = cryptoApi.getRandomValues(new Uint8Array(AES_GCM.IV_LENGTH));
    const wrappingKey = await deriveArgon2idAesKey({
      password,
      salt,
      m: resolvedKdfParams.m,
      t: resolvedKdfParams.t,
      p: resolvedKdfParams.p,
      version: resolvedKdfParams.version,
    });
    const pkcs8 = await cryptoApi.subtle.exportKey('pkcs8', privateKey);
    const encrypted = await cryptoApi.subtle.encrypt(
      {
        name: AES_GCM.ALGORITHM_NAME,
        iv: toBufferSource(iv),
        tagLength: AES_GCM.TAG_LENGTH_BITS,
      },
      wrappingKey,
      pkcs8
    );

    const kdf: Argon2idParams = {
      kdfType: 'argon2id',
      version: resolvedKdfParams.version,
      m: resolvedKdfParams.m,
      t: resolvedKdfParams.t,
      p: resolvedKdfParams.p,
      salt: encodeBase64Url(salt),
    };

    return {
      encryptedKey: encodeBase64Url(new Uint8Array(encrypted)),
      iv: encodeBase64Url(iv),
      kdf,
    };
  } catch (error) {
    throw new Error('Private key wrap failed', { cause: error });
  }
}

interface DecodedWrappedKey {
  salt: Uint8Array;
  iv: Uint8Array;
  encryptedKey: Uint8Array;
  m: number;
  t: number;
  p: number;
  version: 19;
}

/**
 * Validates kdfType and decodes the three base64url fields of a wrapped key.
 * Throws descriptive errors for unsupported kdfType or bad encoding.
 * Called outside try-catch so its errors propagate with their original message.
 */
function validateAndDecodeWrapped(wrapped: WrappedPrivateKey): DecodedWrappedKey {
  if (wrapped.kdf.kdfType !== 'argon2id') {
    throw new Error('Unsupported kdfType for unwrap');
  }

  // kdfType is narrowed to "argon2id" here, so m/t/p/version are accessible.
  const { m, t, p, version } = wrapped.kdf;

  try {
    const salt = decodeBase64Url(wrapped.kdf.salt);
    const iv = decodeBase64Url(wrapped.iv);
    const encryptedKey = decodeBase64Url(wrapped.encryptedKey);
    assertSaltLength(salt);
    assertIvLength(iv);
    return { salt, iv, encryptedKey, m, t, p, version };
  } catch (error) {
    throw new Error('Invalid wrapped private key encoding', { cause: error });
  }
}

/**
 * Derives the Argon2id wrapping key and AES-GCM decrypts a wrapped PKCS8 blob.
 * Shared by unwrapPrivateKey (RSA-OAEP) and unwrapEcdsaPrivateKey (ECDSA).
 * Must be called inside the caller's try-catch so crypto failures (wrong
 * password, tampered ciphertext) are wrapped with a descriptive message.
 */
async function decryptPkcs8(
  decoded: DecodedWrappedKey,
  password: string,
  cryptoApi: Crypto,
  kdfParams?: Argon2idKdfParams
): Promise<Uint8Array> {
  const resolvedKdfParams =
    kdfParams === undefined
      ? {
          m: decoded.m,
          t: decoded.t,
          p: decoded.p,
          version: decoded.version,
        }
      : resolveArgon2idKdfParams(kdfParams);
  const wrappingKey = await deriveArgon2idAesKey({
    password,
    salt: decoded.salt,
    m: resolvedKdfParams.m,
    t: resolvedKdfParams.t,
    p: resolvedKdfParams.p,
    version: resolvedKdfParams.version,
  });

  const decrypted = await cryptoApi.subtle.decrypt(
    {
      name: AES_GCM.ALGORITHM_NAME,
      iv: toBufferSource(decoded.iv),
      tagLength: AES_GCM.TAG_LENGTH_BITS,
    },
    wrappingKey,
    toBufferSource(decoded.encryptedKey)
  );

  return new Uint8Array(decrypted);
}

async function importPkcs8Key(
  pkcs8: Uint8Array,
  algorithm: RsaHashedImportParams | EcKeyImportParams,
  keyUsages: ReadonlyArray<KeyUsage>
): Promise<CryptoKey> {
  return getCryptoApi().subtle.importKey('pkcs8', toBufferSource(pkcs8), algorithm, false, [
    ...keyUsages,
  ]);
}

export async function unwrapPrivateKey({
  wrapped,
  password,
  kdfParams,
}: UnwrapPrivateKeyParams): Promise<CryptoKey> {
  const cryptoApi = getCryptoApi();
  assertPassword(password);
  const decoded = validateAndDecodeWrapped(wrapped);
  let pkcs8: Uint8Array | null = null;

  try {
    pkcs8 = await decryptPkcs8(decoded, password, cryptoApi, kdfParams);
    return await importPkcs8Key(
      pkcs8,
      {
        name: RSA_OAEP.ALGORITHM_NAME,
        hash: RSA_OAEP.HASH_ALGORITHM,
      },
      RSA_OAEP.KEY_USAGES_PRIVATE
    );
  } catch (error) {
    throw new Error('Private key unwrap failed', { cause: error });
  } finally {
    wipeBytes(decoded.salt);
    wipeBytes(decoded.iv);
    wipeBytes(decoded.encryptedKey);
    wipeBytes(pkcs8);
  }
}

export async function unwrapEcdsaPrivateKey({
  wrapped,
  password,
  kdfParams,
}: UnwrapPrivateKeyParams): Promise<CryptoKey> {
  const cryptoApi = getCryptoApi();
  assertPassword(password);
  const decoded = validateAndDecodeWrapped(wrapped);
  let pkcs8: Uint8Array | null = null;

  try {
    pkcs8 = await decryptPkcs8(decoded, password, cryptoApi, kdfParams);
    return await importPkcs8Key(
      pkcs8,
      {
        name: ECDSA.ALGORITHM_NAME,
        namedCurve: ECDSA.CURVE,
      },
      ECDSA.KEY_USAGES_SIGN
    );
  } catch (error) {
    throw new Error('ECDSA private key unwrap failed', { cause: error });
  } finally {
    wipeBytes(decoded.salt);
    wipeBytes(decoded.iv);
    wipeBytes(decoded.encryptedKey);
    wipeBytes(pkcs8);
  }
}
