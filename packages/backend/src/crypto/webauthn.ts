import type { AssertionJSON, Base64Url, StoredCredential } from '@zerolink/shared';
import { decode } from 'cborg';

import {
  decodeBase64Url,
  encodeBase64Url,
  getCryptoApi,
  sha256Bytes,
  toArrayBufferBytes,
  toUtf8Bytes,
} from './bytes.ts';

export interface WebAuthnVerifyParams {
  assertion: AssertionJSON;
  expectedChallenge: Base64Url;
  storedCredential: StoredCredential;
  rpId: string;
  rpOrigin: string;
}

export type WebAuthnVerifyResult =
  | { readonly ok: true; readonly newSignCount: number }
  | { readonly ok: false; readonly error: string };

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

const AUTHENTICATOR_DATA_MIN_LENGTH = 37;
const RP_ID_HASH_LENGTH = 32;
const FLAGS_OFFSET = 32;
const SIGN_COUNT_OFFSET = 33;
const UP_FLAG_BIT = 0x01;
const UV_FLAG_BIT = 0x04;

/**
 * Generates WebAuthn PublicKeyCredentialCreationOptions.
 * Accepts both new profiles ('secure') and legacy profiles for backward compatibility.
 */
export function generateCreationOptions(params: {
  rpId: string;
  rpName: string;
  uuid: string;
  challenge: Uint8Array;
  securityProfile: string;
}): Record<string, unknown> {
  const { rpId, rpName, uuid, challenge, securityProfile } = params;

  // Require UV/RK for 'secure' and all legacy strict-tier profiles
  const strict =
    securityProfile === 'secure' ||
    securityProfile === 'strict' ||
    securityProfile === 'hardware_only';

  return {
    challenge: encodeBase64Url(challenge),
    rp: {
      name: rpName,
      id: rpId,
    },
    user: {
      id: encodeBase64Url(toUtf8Bytes(uuid)),
      name: `zerolink-${uuid}`,
      displayName: `ZeroLink (${uuid})`,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      userVerification: strict ? 'required' : 'preferred',
      residentKey: strict ? 'required' : 'preferred',
      requireResidentKey: strict,
    },
    attestation: 'none',
    timeout: 60000,
  };
}

/**
 * Verifies a WebAuthn assertion against stored credential data.
 */
export async function verifyAssertion(params: WebAuthnVerifyParams): Promise<WebAuthnVerifyResult> {
  const { assertion, expectedChallenge, storedCredential, rpId, rpOrigin } = params;

  // Step 1: Credential ID match
  if (assertion.id !== storedCredential.credentialId) {
    return { ok: false, error: 'credential ID mismatch' };
  }

  // Step 2: Decode and validate clientDataJSON
  const clientDataBytes = decodeBase64Url(assertion.response.clientDataJSON);
  const clientDataText = new TextDecoder().decode(clientDataBytes);

  let clientData: ClientData;
  try {
    clientData = JSON.parse(clientDataText) as ClientData;
  } catch {
    return { ok: false, error: 'invalid clientDataJSON' };
  }

  if (clientData.type !== 'webauthn.get') {
    return {
      ok: false,
      error: `unexpected clientData type: ${clientData.type}`,
    };
  }

  if (clientData.origin !== rpOrigin) {
    return { ok: false, error: 'origin mismatch' };
  }

  if (clientData.challenge !== expectedChallenge) {
    return { ok: false, error: 'challenge mismatch' };
  }

  // Step 3: Parse authenticatorData
  const authData = decodeBase64Url(assertion.response.authenticatorData);
  if (authData.byteLength < AUTHENTICATOR_DATA_MIN_LENGTH) {
    return { ok: false, error: 'authenticatorData too short' };
  }

  // Verify rpIdHash
  const rpIdHashFromAuth = authData.slice(0, RP_ID_HASH_LENGTH);
  const expectedRpIdHash = await sha256Bytes([toUtf8Bytes(rpId)]);
  if (!constantTimeEqualBytes(rpIdHashFromAuth, expectedRpIdHash)) {
    return { ok: false, error: 'rpIdHash mismatch' };
  }

  // Check UP flag
  const flags = authData[FLAGS_OFFSET];
  if (flags === undefined || (flags & UP_FLAG_BIT) === 0) {
    return { ok: false, error: 'user presence flag not set' };
  }
  if ((flags & UV_FLAG_BIT) === 0) {
    return { ok: false, error: 'user verification flag not set' };
  }

  // Extract signCount (4 bytes, big-endian)
  const signCountView = new DataView(
    toArrayBufferBytes(authData.slice(SIGN_COUNT_OFFSET, SIGN_COUNT_OFFSET + 4)).buffer
  );
  const newSignCount = signCountView.getUint32(0, false);

  // Step 4: Construct signed data
  const cryptoApi = getCryptoApi();
  const clientDataHash = new Uint8Array(
    await cryptoApi.subtle.digest('SHA-256', toArrayBufferBytes(clientDataBytes))
  );
  const signedData = new Uint8Array(authData.byteLength + clientDataHash.byteLength);
  signedData.set(authData, 0);
  signedData.set(clientDataHash, authData.byteLength);

  // Step 5: Verify signature
  //
  // The stored publicKey is COSE CBOR-encoded (raw bytes from the authenticator's
  // attested credential data). We decode it to detect the algorithm, then import
  // via JWK to support both ES256 (ECDSA P-256) and RS256 (RSASSA-PKCS1-v1_5).
  const signatureBytes = decodeBase64Url(assertion.response.signature);
  const publicKeyBytes = decodeBase64Url(storedCredential.publicKey);

  // cborg's decode() rejects integer-keyed maps by default; useMaps:true returns a Map.
  let coseKey: Map<number, unknown>;
  try {
    coseKey = decode(publicKeyBytes, { useMaps: true }) as Map<number, unknown>;
  } catch {
    return {
      ok: false,
      error: 'failed to decode stored public key (expected COSE CBOR)',
    };
  }

  const coseAlg = coseKey.get(3);

  if (coseAlg === -7) {
    // ES256: ECDSA P-256
    const x = coseKey.get(-2);
    const y = coseKey.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
      return {
        ok: false,
        error: 'invalid COSE P-256 key: missing x or y coordinates',
      };
    }

    let publicKey: CryptoKey;
    try {
      publicKey = await cryptoApi.subtle.importKey(
        'jwk',
        {
          kty: 'EC',
          crv: 'P-256',
          x: encodeBase64Url(x),
          y: encodeBase64Url(y),
          ext: true,
          key_ops: ['verify'],
        },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
    } catch {
      return { ok: false, error: 'failed to import stored P-256 public key' };
    }

    let p1363Sig: Uint8Array;
    try {
      p1363Sig = isP1363Signature(signatureBytes) ? signatureBytes : derToP1363(signatureBytes);
    } catch {
      return { ok: false, error: 'invalid ECDSA signature encoding' };
    }

    const valid = await cryptoApi.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      toArrayBufferBytes(p1363Sig),
      toArrayBufferBytes(signedData)
    );

    if (!valid) {
      return { ok: false, error: 'signature verification failed' };
    }
  } else if (coseAlg === -257) {
    // RS256: RSASSA-PKCS1-v1_5 SHA-256
    // COSE RSA key parameters: -1 = n (modulus), -2 = e (public exponent)
    const n = coseKey.get(-1);
    const e = coseKey.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) {
      return {
        ok: false,
        error: 'invalid COSE RSA key: missing n or e components',
      };
    }

    let publicKey: CryptoKey;
    try {
      publicKey = await cryptoApi.subtle.importKey(
        'jwk',
        {
          kty: 'RSA',
          alg: 'RS256',
          n: encodeBase64Url(n),
          e: encodeBase64Url(e),
          ext: true,
          key_ops: ['verify'],
        },
        { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
        false,
        ['verify']
      );
    } catch {
      return { ok: false, error: 'failed to import stored RSA public key' };
    }

    const valid = await cryptoApi.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      toArrayBufferBytes(signatureBytes),
      toArrayBufferBytes(signedData)
    );

    if (!valid) {
      return { ok: false, error: 'signature verification failed' };
    }
  } else {
    return {
      ok: false,
      error: `unsupported COSE key algorithm: ${String(coseAlg)}`,
    };
  }

  // Step 6: signCount check (log regression, don't hard-block per PRD H.5)
  if (
    newSignCount > 0 &&
    storedCredential.signCount > 0 &&
    newSignCount <= storedCredential.signCount
  ) {
    // Potential cloned authenticator — log but don't reject
    // In production this would trigger an alert
  }

  return { ok: true, newSignCount };
}

/**
 * Converts a DER-encoded ECDSA signature to IEEE P1363 format (r || s, 64 bytes for P-256).
 *
 * DER structure: 0x30 [total-len] 0x02 [r-len] [r-bytes] 0x02 [s-len] [s-bytes]
 *
 * WebCrypto `verify()` for ECDSA requires P1363 format but browsers may produce
 * DER signatures. This ensures interoperability.
 */
export function derToP1363(derSig: Uint8Array): Uint8Array {
  const P256_COMPONENT_LENGTH = 32;
  const P1363_LENGTH = P256_COMPONENT_LENGTH * 2;

  if (derSig[0] !== 0x30) {
    throw new Error('invalid DER signature: expected SEQUENCE tag 0x30');
  }

  let offset = 2; // skip SEQUENCE tag and length

  // Parse r
  if (derSig[offset] !== 0x02) {
    throw new Error('invalid DER signature: expected INTEGER tag 0x02 for r');
  }
  offset += 1;
  const rLen = derSig[offset] ?? 0;
  offset += 1;
  const rBytes = derSig.slice(offset, offset + rLen);
  offset += rLen;

  // Parse s
  if (derSig[offset] !== 0x02) {
    throw new Error('invalid DER signature: expected INTEGER tag 0x02 for s');
  }
  offset += 1;
  const sLen = derSig[offset] ?? 0;
  offset += 1;
  const sBytes = derSig.slice(offset, offset + sLen);

  const result = new Uint8Array(P1363_LENGTH);
  copyPadded(rBytes, result, 0, P256_COMPONENT_LENGTH);
  copyPadded(sBytes, result, P256_COMPONENT_LENGTH, P256_COMPONENT_LENGTH);

  return result;
}

function isP1363Signature(sig: Uint8Array): boolean {
  // P1363 for P-256 is exactly 64 bytes and doesn't start with 0x30
  return sig.byteLength === 64 && sig[0] !== 0x30;
}

/**
 * Copy a DER integer component into a fixed-width field, right-aligned
 * and zero-padded. Strips leading zero padding byte if present.
 */
function copyPadded(
  src: Uint8Array,
  dst: Uint8Array,
  dstOffset: number,
  fieldLength: number
): void {
  // Strip leading zero byte used for sign bit in DER
  let srcOffset = 0;
  let srcLen = src.byteLength;
  while (srcLen > fieldLength && src[srcOffset] === 0) {
    srcOffset += 1;
    srcLen -= 1;
  }

  if (srcLen > fieldLength) {
    throw new Error(`DER integer component too large: ${srcLen} > ${fieldLength}`);
  }

  // Right-align within field (zero-pad left)
  dst.set(src.subarray(srcOffset, srcOffset + srcLen), dstOffset + (fieldLength - srcLen));
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.byteLength; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }

  return mismatch === 0;
}
