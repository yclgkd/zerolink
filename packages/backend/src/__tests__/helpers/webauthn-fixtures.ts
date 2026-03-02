import type { AssertionJSON, Base64Url } from '@zerolink/shared';
import { encode } from 'cborg';

import {
  decodeBase64Url,
  encodeBase64Url,
  toArrayBufferBytes,
  toUtf8Bytes,
} from '../../crypto/bytes.ts';

export interface MockAssertionParams {
  credentialId: Base64Url;
  rpId: string;
  rpOrigin: string;
  challenge: Base64Url;
  signCount: number;
  authenticatorFlags?: number;
}

export interface MockAssertionResult {
  assertion: AssertionJSON;
  /** COSE CBOR-encoded public key — matches what verifyAttestation stores in production. */
  publicKeyCose: Base64Url;
}

/**
 * Creates a real WebAuthn-like assertion using a P-256 keypair.
 * Signs authenticatorData || SHA-256(clientDataJSON) with the private key.
 * Returns the assertion and a COSE CBOR-encoded public key matching production storage format.
 */
export async function createMockAssertion(
  params: MockAssertionParams
): Promise<MockAssertionResult> {
  const { credentialId, rpId, rpOrigin, challenge, signCount, authenticatorFlags = 0x05 } = params;

  // Generate a P-256 keypair
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  // Export JWK to extract x/y coordinates, then construct COSE key (EC2 / ES256 / P-256).
  // This matches the CBOR-encoded credentialPublicKey stored by verifyAttestation in production.
  const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as {
    x: string;
    y: string;
  };
  const xBytes = decodeBase64Url(jwk.x as Base64Url);
  const yBytes = decodeBase64Url(jwk.y as Base64Url);
  const coseMap = new Map<number, unknown>([
    [1, 2], // kty = EC (2)
    [3, -7], // alg = ES256 (-7)
    [-1, 1], // crv = P-256 (1)
    [-2, xBytes],
    [-3, yBytes],
  ]);
  const publicKeyCose = encodeBase64Url(encode(coseMap));

  // Build clientDataJSON
  const clientData = {
    type: 'webauthn.get',
    challenge: challenge,
    origin: rpOrigin,
    crossOrigin: false,
  };
  const clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData));
  const clientDataB64 = encodeBase64Url(clientDataJSON);

  // Build authenticatorData:
  //   rpIdHash (32 bytes) || flags (1 byte) || signCount (4 bytes big-endian)
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', toArrayBufferBytes(toUtf8Bytes(rpId)))
  );
  const flags = authenticatorFlags; // Defaults to UP + UV
  const signCountBytes = new Uint8Array(4);
  new DataView(signCountBytes.buffer).setUint32(0, signCount, false);

  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(rpIdHash, 0);
  authenticatorData[32] = flags;
  authenticatorData.set(signCountBytes, 33);
  const authenticatorDataB64 = encodeBase64Url(authenticatorData);

  // Sign: authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signedData = new Uint8Array(authenticatorData.byteLength + clientDataHash.byteLength);
  signedData.set(authenticatorData, 0);
  signedData.set(clientDataHash, authenticatorData.byteLength);

  const derSignature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signedData)
  );
  const signatureB64 = encodeBase64Url(derSignature);

  const assertion: AssertionJSON = {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: clientDataB64,
      authenticatorData: authenticatorDataB64,
      signature: signatureB64,
    },
  };

  return { assertion, publicKeyCose };
}

/**
 * Creates a mock assertion with tampered authenticator data
 * (different rpIdHash) to test signature verification failure.
 */
export async function createTamperedAssertion(
  params: MockAssertionParams
): Promise<MockAssertionResult> {
  const result = await createMockAssertion(params);

  // Tamper with authenticatorData by flipping a byte in rpIdHash
  const authDataBytes = decodeBase64UrlSimple(result.assertion.response.authenticatorData);
  authDataBytes[0] = (authDataBytes[0] ?? 0) ^ 0xff; // Flip first byte
  const tamperedAuthData = encodeBase64Url(authDataBytes);

  return {
    ...result,
    assertion: {
      ...result.assertion,
      response: {
        ...result.assertion.response,
        authenticatorData: tamperedAuthData,
      },
    },
  };
}

function decodeBase64UrlSimple(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
