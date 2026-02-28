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
  let sigBytes: Uint8Array;
  try {
    const pairs = signatureHex.match(/.{2}/gu);
    if (!pairs || pairs.length === 0) {
      return { ok: false, error: 'empty signature' };
    }
    sigBytes = Uint8Array.from(pairs.map((b) => Number.parseInt(b, 16)));
  } catch {
    return { ok: false, error: 'invalid signature hex encoding' };
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
