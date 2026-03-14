import { RSA_OAEP } from '../constants.ts';
import type { RSAPublicKeyJWK } from '../types.ts';
import { toBufferSource } from './aes.ts';

const PUBLIC_KEY_USAGES = [...RSA_OAEP.KEY_USAGES_PUBLIC];
const PRIVATE_KEY_USAGES = [...RSA_OAEP.KEY_USAGES_PRIVATE];

function getCryptoApi(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('WebCrypto is not available');
  }
  return cryptoApi;
}

function assertNonEmptyContentKey(contentKey: Uint8Array): void {
  if (contentKey.byteLength === 0) {
    throw new Error('contentKey must not be empty');
  }
}

export async function generateReceiverKeyPair(): Promise<CryptoKeyPair> {
  return getCryptoApi().subtle.generateKey(
    {
      name: RSA_OAEP.ALGORITHM_NAME,
      modulusLength: RSA_OAEP.MODULUS_LENGTH_BITS,
      publicExponent: RSA_OAEP.PUBLIC_EXPONENT_BYTES,
      hash: RSA_OAEP.HASH_ALGORITHM,
    },
    true,
    [...PUBLIC_KEY_USAGES, ...PRIVATE_KEY_USAGES]
  ) as Promise<CryptoKeyPair>;
}

export async function exportReceiverPublicKeyToJwk(publicKey: CryptoKey): Promise<RSAPublicKeyJWK> {
  const jwk = await getCryptoApi().subtle.exportKey('jwk', publicKey);

  return {
    kty: 'RSA',
    alg: 'RSA-OAEP-256',
    n: String(jwk.n) as RSAPublicKeyJWK['n'],
    e: String(jwk.e) as RSAPublicKeyJWK['e'],
    ext: true,
    key_ops: ['encrypt'],
  };
}

export async function importReceiverPublicKeyFromJwk(jwk: RSAPublicKeyJWK): Promise<CryptoKey> {
  const importableJwk: JsonWebKey = {
    ...jwk,
    key_ops: [...jwk.key_ops],
  };

  try {
    return await getCryptoApi().subtle.importKey(
      'jwk',
      importableJwk,
      {
        name: RSA_OAEP.ALGORITHM_NAME,
        hash: RSA_OAEP.HASH_ALGORITHM,
      },
      true,
      PUBLIC_KEY_USAGES
    );
  } catch (error) {
    throw new Error('Invalid RSA-OAEP public JWK', { cause: error });
  }
}

export interface WrapContentKeyParams {
  receiverPublicKey: CryptoKey;
  contentKey: Uint8Array;
}

export async function wrapContentKey({
  receiverPublicKey,
  contentKey,
}: WrapContentKeyParams): Promise<Uint8Array> {
  assertNonEmptyContentKey(contentKey);

  try {
    const wrapped = await getCryptoApi().subtle.encrypt(
      { name: RSA_OAEP.ALGORITHM_NAME },
      receiverPublicKey,
      toBufferSource(contentKey)
    );
    return new Uint8Array(wrapped);
  } catch (error) {
    throw new Error('RSA-OAEP wrap failed', { cause: error });
  }
}

export interface UnwrapContentKeyParams {
  receiverPrivateKey: CryptoKey;
  wrappedKey: Uint8Array;
}

export async function unwrapContentKey({
  receiverPrivateKey,
  wrappedKey,
}: UnwrapContentKeyParams): Promise<Uint8Array> {
  try {
    const unwrapped = await getCryptoApi().subtle.decrypt(
      { name: RSA_OAEP.ALGORITHM_NAME },
      receiverPrivateKey,
      toBufferSource(wrappedKey)
    );
    return new Uint8Array(unwrapped);
  } catch (error) {
    throw new Error('RSA-OAEP unwrap failed', { cause: error });
  }
}
