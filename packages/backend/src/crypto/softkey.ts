import type { ECDSAPublicKeyJWK, HexString, Result } from '@zerolink/shared';
import { ECDSA } from '@zerolink/shared';

import { getCryptoApi, toArrayBufferBytes } from './bytes.ts';

export interface SoftkeyVerifyParams {
  softkeyPubJwk: ECDSAPublicKeyJWK;
  /** Raw bytes of the payload that was signed. */
  payload: Uint8Array;
  /** IEEE P1363 ECDSA signature as lowercase hex. */
  signatureHex: HexString;
}

export type SoftkeyVerifyResult = Result<void, string>;

const ECDSA_P256_P1363_SIGNATURE_BYTES = 64;
const ECDSA_P256_P1363_SIGNATURE_HEX_LENGTH = ECDSA_P256_P1363_SIGNATURE_BYTES * 2;

/**
 * Verifies an ECDSA P-256 signature produced by the softkey compat mode.
 * PRD §9: used when the channel's adminMode is 'softkey'.
 */
export async function verifySoftkeySignature(
  params: SoftkeyVerifyParams
): Promise<SoftkeyVerifyResult> {
  const { softkeyPubJwk, payload, signatureHex } = params;
  const cryptoApi = getCryptoApi();

  // Decode hex signature to bytes
  if (signatureHex.length === 0) {
    return { ok: false, error: 'empty signature' };
  }
  if (signatureHex.length % 2 !== 0) {
    return { ok: false, error: 'invalid signature hex encoding' };
  }
  if (!/^[0-9a-f]+$/u.test(signatureHex)) {
    return { ok: false, error: 'invalid signature hex encoding' };
  }
  if (signatureHex.length !== ECDSA_P256_P1363_SIGNATURE_HEX_LENGTH) {
    return { ok: false, error: 'invalid signature length' };
  }

  const sigBytes = new Uint8Array(ECDSA_P256_P1363_SIGNATURE_BYTES);
  for (let index = 0; index < signatureHex.length; index += 2) {
    const parsedByte = Number.parseInt(signatureHex.slice(index, index + 2), 16);
    if (Number.isNaN(parsedByte)) {
      return { ok: false, error: 'invalid signature hex encoding' };
    }
    sigBytes[index / 2] = parsedByte;
  }

  // Import the JWK public key for verification
  let publicKey: CryptoKey;
  try {
    publicKey = await cryptoApi.subtle.importKey(
      'jwk',
      softkeyPubJwk as unknown as JsonWebKey,
      { name: ECDSA.ALGORITHM_NAME, namedCurve: ECDSA.CURVE },
      false,
      [...ECDSA.KEY_USAGES_VERIFY]
    );
  } catch {
    return { ok: false, error: 'failed to import softkey public key' };
  }

  // Verify the signature
  try {
    const valid = await cryptoApi.subtle.verify(
      { name: ECDSA.ALGORITHM_NAME, hash: ECDSA.HASH_ALGORITHM },
      publicKey,
      toArrayBufferBytes(sigBytes),
      toArrayBufferBytes(payload)
    );
    return valid
      ? { ok: true, data: undefined }
      : { ok: false, error: 'signature verification failed' };
  } catch {
    return { ok: false, error: 'signature verification error' };
  }
}
