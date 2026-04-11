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

export interface MockAuthenticator {
  credentialId: Base64Url;
  /** COSE CBOR-encoded public key — matches what verifyAttestation stores in production. */
  publicKeyCose: Base64Url;
  signAssertion(params: Omit<MockAssertionParams, 'credentialId'>): Promise<AssertionJSON>;
}

async function createP256KeyMaterial(): Promise<{
  keyPair: CryptoKeyPair;
  publicKeyCose: Base64Url;
}> {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as {
    x: string;
    y: string;
  };
  const xBytes = decodeBase64Url(jwk.x as Base64Url);
  const yBytes = decodeBase64Url(jwk.y as Base64Url);
  const coseMap = new Map<number, unknown>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, xBytes],
    [-3, yBytes],
  ]);

  return {
    keyPair,
    publicKeyCose: encodeBase64Url(encode(coseMap)),
  };
}

async function signAssertionWithKeyPair(
  keyPair: CryptoKeyPair,
  params: MockAssertionParams
): Promise<AssertionJSON> {
  const { credentialId, rpId, rpOrigin, challenge, signCount, authenticatorFlags = 0x05 } = params;

  const clientData = {
    type: 'webauthn.get',
    challenge,
    origin: rpOrigin,
    crossOrigin: false,
  };
  const clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData));
  const clientDataB64 = encodeBase64Url(clientDataJSON);

  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', toArrayBufferBytes(toUtf8Bytes(rpId)))
  );
  const signCountBytes = new Uint8Array(4);
  new DataView(signCountBytes.buffer).setUint32(0, signCount, false);

  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(rpIdHash, 0);
  authenticatorData[32] = authenticatorFlags;
  authenticatorData.set(signCountBytes, 33);
  const authenticatorDataB64 = encodeBase64Url(authenticatorData);

  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signedData = new Uint8Array(authenticatorData.byteLength + clientDataHash.byteLength);
  signedData.set(authenticatorData, 0);
  signedData.set(clientDataHash, authenticatorData.byteLength);

  const derSignature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signedData)
  );

  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: clientDataB64,
      authenticatorData: authenticatorDataB64,
      signature: encodeBase64Url(derSignature),
    },
  };
}

/**
 * Creates a reusable mock authenticator that can sign multiple assertions
 * while keeping the same credential public key.
 */
export async function createMockAuthenticator(credentialId: Base64Url): Promise<MockAuthenticator> {
  const { keyPair, publicKeyCose } = await createP256KeyMaterial();

  return {
    credentialId,
    publicKeyCose,
    async signAssertion(params) {
      return signAssertionWithKeyPair(keyPair, { ...params, credentialId });
    },
  };
}

/**
 * Creates a real WebAuthn-like assertion using a P-256 keypair.
 * Signs authenticatorData || SHA-256(clientDataJSON) with the private key.
 * Returns the assertion and a COSE CBOR-encoded public key matching production storage format.
 */
export async function createMockAssertion(
  params: MockAssertionParams
): Promise<MockAssertionResult> {
  const authenticator = await createMockAuthenticator(params.credentialId);
  const signParams: Omit<MockAssertionParams, 'credentialId'> = {
    rpId: params.rpId,
    rpOrigin: params.rpOrigin,
    challenge: params.challenge,
    signCount: params.signCount,
    ...(params.authenticatorFlags !== undefined
      ? { authenticatorFlags: params.authenticatorFlags }
      : {}),
  };
  return {
    assertion: await authenticator.signAssertion(signParams),
    publicKeyCose: authenticator.publicKeyCose,
  };
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
