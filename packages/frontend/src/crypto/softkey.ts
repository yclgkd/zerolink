import type { Base64Url, ECDSAPublicKeyJWK, HexString, WrappedPrivateKey } from '@zerolink/shared';
import { ECDSA } from '@zerolink/shared';
import { unwrapEcdsaPrivateKey, wrapPrivateKey } from '@zerolink/shared/crypto/kdf';

/**
 * Generates an extractable ECDSA P-256 keypair for softkey compat mode.
 * PRD §9: used as admin credential when WebAuthn is unavailable.
 *
 * Both "sign" and "verify" are passed so WebCrypto assigns the correct usage
 * to each key: the private key receives ["sign"] and the public key receives
 * ["verify"]. Passing only ["sign"] would leave the public key with no usages.
 */
export async function generateSoftkeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: ECDSA.ALGORITHM_NAME, namedCurve: ECDSA.CURVE }, true, [
    ...ECDSA.KEY_USAGES_SIGN,
    ...ECDSA.KEY_USAGES_VERIFY,
  ]);
}

/**
 * Exports an ECDSA P-256 public key as a JWK conforming to ECDSAPublicKeyJWK.
 */
export async function exportSoftkeyPublicJwk(publicKey: CryptoKey): Promise<ECDSAPublicKeyJWK> {
  const raw = await crypto.subtle.exportKey('jwk', publicKey);

  return {
    kty: 'EC',
    crv: 'P-256',
    x: raw.x as Base64Url,
    y: raw.y as Base64Url,
    ext: true,
    key_ops: ['verify'],
  } satisfies ECDSAPublicKeyJWK;
}

/**
 * Wraps an ECDSA P-256 private key using Argon2id-derived AES-256-GCM.
 * Delegates to shared `wrapPrivateKey` (PKCS8 export + AES-GCM encrypt).
 */
export async function wrapSoftkeyPrivateKey(
  privateKey: CryptoKey,
  passphrase: string
): Promise<WrappedPrivateKey> {
  return wrapPrivateKey({ privateKey, password: passphrase });
}

/**
 * Unwraps a wrapped ECDSA P-256 private key using Argon2id-derived AES-256-GCM.
 * Returns a CryptoKey with usages: ['sign'].
 */
export async function unwrapSoftkeyPrivateKey(
  wrapped: WrappedPrivateKey,
  passphrase: string
): Promise<CryptoKey> {
  return unwrapEcdsaPrivateKey({ wrapped, password: passphrase });
}

/**
 * Signs a payload with an ECDSA P-256 private key.
 * Returns an IEEE P1363 signature (64 bytes for P-256) encoded as lowercase hex.
 * PRD §9: softkeySignature is transmitted as HexString.
 */
export async function softkeySign(privateKey: CryptoKey, payload: Uint8Array): Promise<HexString> {
  const sigBuf = await crypto.subtle.sign(
    { name: ECDSA.ALGORITHM_NAME, hash: ECDSA.HASH_ALGORITHM },
    privateKey,
    payload as BufferSource
  );

  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('') as HexString;
}
