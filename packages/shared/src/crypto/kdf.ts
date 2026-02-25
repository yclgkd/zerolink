import { argon2idAsync } from '@noble/hashes/argon2.js';

import { AES_GCM, ARGON2ID, RSA_OAEP } from '../constants.ts';
import type { Argon2idParams, Base64Url, WrappedPrivateKey } from '../types.ts';

const ARGON2_VERSION = 19 as const;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export interface WrapPrivateKeyParams {
  privateKey: CryptoKey;
  password: string;
}

export interface UnwrapPrivateKeyParams {
  wrapped: WrappedPrivateKey;
  password: string;
}

interface DeriveArgon2idKeyParams {
  password: string;
  salt: Uint8Array;
  m: number;
  t: number;
  p: number;
  version: number;
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
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

  return cryptoApi.subtle.importKey(
    'raw',
    toArrayBuffer(keyMaterial),
    { name: AES_GCM.ALGORITHM_NAME },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function wrapPrivateKey({
  privateKey,
  password,
}: WrapPrivateKeyParams): Promise<WrappedPrivateKey> {
  const cryptoApi = getCryptoApi();
  assertPassword(password);

  try {
    const salt = cryptoApi.getRandomValues(new Uint8Array(ARGON2ID.SALT_LENGTH));
    const iv = cryptoApi.getRandomValues(new Uint8Array(AES_GCM.IV_LENGTH));
    const wrappingKey = await deriveArgon2idAesKey({
      password,
      salt,
      m: ARGON2ID.MEMORY_COST_KB,
      t: ARGON2ID.TIME_COST,
      p: ARGON2ID.PARALLELISM,
      version: ARGON2_VERSION,
    });
    const pkcs8 = await cryptoApi.subtle.exportKey('pkcs8', privateKey);
    const encrypted = await cryptoApi.subtle.encrypt(
      {
        name: AES_GCM.ALGORITHM_NAME,
        iv: toArrayBuffer(iv),
        tagLength: AES_GCM.TAG_LENGTH_BITS,
      },
      wrappingKey,
      pkcs8
    );

    const kdf: Argon2idParams = {
      kdfType: 'argon2id',
      version: ARGON2_VERSION,
      m: ARGON2ID.MEMORY_COST_KB,
      t: ARGON2ID.TIME_COST,
      p: ARGON2ID.PARALLELISM,
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

export async function unwrapPrivateKey({
  wrapped,
  password,
}: UnwrapPrivateKeyParams): Promise<CryptoKey> {
  const cryptoApi = getCryptoApi();
  assertPassword(password);

  if (wrapped.kdf.kdfType !== 'argon2id') {
    throw new Error('Unsupported kdfType for unwrap');
  }

  let salt: Uint8Array;
  let iv: Uint8Array;
  let encryptedKey: Uint8Array;

  try {
    salt = decodeBase64Url(wrapped.kdf.salt);
    iv = decodeBase64Url(wrapped.iv);
    encryptedKey = decodeBase64Url(wrapped.encryptedKey);
    assertSaltLength(salt);
    assertIvLength(iv);
  } catch (error) {
    throw new Error('Invalid wrapped private key encoding', { cause: error });
  }

  try {
    const wrappingKey = await deriveArgon2idAesKey({
      password,
      salt,
      m: wrapped.kdf.m,
      t: wrapped.kdf.t,
      p: wrapped.kdf.p,
      version: wrapped.kdf.version,
    });
    const pkcs8 = await cryptoApi.subtle.decrypt(
      {
        name: AES_GCM.ALGORITHM_NAME,
        iv: toArrayBuffer(iv),
        tagLength: AES_GCM.TAG_LENGTH_BITS,
      },
      wrappingKey,
      toArrayBuffer(encryptedKey)
    );

    return await cryptoApi.subtle.importKey(
      'pkcs8',
      pkcs8,
      {
        name: RSA_OAEP.ALGORITHM_NAME,
        hash: RSA_OAEP.HASH_ALGORITHM,
      },
      true,
      [...RSA_OAEP.KEY_USAGES_PRIVATE]
    );
  } catch (error) {
    throw new Error('Private key unwrap failed', { cause: error });
  }
}
