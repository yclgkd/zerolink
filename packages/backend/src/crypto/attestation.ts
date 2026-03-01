import type { Base64Url } from '@zerolink/shared';
import { decode } from 'cborg';
import {
  decodeBase64Url,
  encodeBase64Url,
  getCryptoApi,
  sha256Bytes,
  toArrayBufferBytes,
  toUtf8Bytes,
} from './bytes.ts';

/**
 * Parsed authData components.
 */
export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  aaguid?: Uint8Array;
  credentialId?: Uint8Array;
  credentialPublicKey?: Uint8Array;
}

/**
 * Attestation verification result.
 */
export interface AttestationVerificationResult {
  verified: boolean;
  fmt: string;
  credentialId: Base64Url;
  publicKey: Base64Url;
  aaguid: Base64Url;
  signCount: number;
  transports?: AuthenticatorTransport[];
  warning?: string | undefined;
}

/**
 * Parses the attested credential data within authData.
 */
function parseAttestedData(
  authData: Uint8Array,
  offset: number
): {
  aaguid: Uint8Array;
  credentialId: Uint8Array;
  credentialPublicKey: Uint8Array;
} {
  if (authData.length < offset + 16 + 2) {
    throw new Error('Authenticator data too short for attested credential data');
  }

  const aaguid = authData.slice(offset, offset + 16);
  const credentialIdLength = new DataView(
    authData.buffer,
    authData.byteOffset + offset + 16,
    2
  ).getUint16(0, false);

  if (authData.length < offset + 16 + 2 + credentialIdLength) {
    throw new Error('Authenticator data too short for credential ID');
  }

  const credentialId = authData.slice(offset + 16 + 2, offset + 16 + 2 + credentialIdLength);
  const credentialPublicKey = authData.slice(offset + 16 + 2 + credentialIdLength);

  return { aaguid, credentialId, credentialPublicKey };
}

/**
 * Parses the authenticatorData buffer.
 */
export function parseAuthenticatorData(authData: Uint8Array): AuthenticatorData {
  if (authData.length < 37) {
    throw new Error('Authenticator data too short');
  }

  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32] ?? 0;
  const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false);

  const result: AuthenticatorData = { rpIdHash, flags, signCount };

  if (flags & 0x40) {
    const attested = parseAttestedData(authData, 37);
    result.aaguid = attested.aaguid;
    result.credentialId = attested.credentialId;
    result.credentialPublicKey = attested.credentialPublicKey;
  }

  return result;
}

/**
 * Validates SPKI coordinates for P-256.
 */
function getCoseCoordinates(decoded: Record<number, unknown>): {
  x: Uint8Array;
  y: Uint8Array;
} {
  if (decoded[1] !== 2 || decoded[3] !== -7 || decoded[-1] !== 1) {
    throw new Error('Unsupported COSE key format (only P-256/ES256 supported)');
  }

  const x = decoded[-2];
  const y = decoded[-3];

  if (
    !(x instanceof Uint8Array) ||
    !(y instanceof Uint8Array) ||
    x.length !== 32 ||
    y.length !== 32
  ) {
    throw new Error('Invalid COSE key coordinates');
  }

  return { x, y };
}

/**
 * Minimal COSE P-256 key to SPKI converter.
 */
export function coseKeyToSpki(coseKey: Uint8Array): Uint8Array {
  const { x, y } = getCoseCoordinates(decode(coseKey) as Record<number, unknown>);

  const spki = new Uint8Array(91);
  spki.set([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04,
  ]);
  spki.set(x, 27);
  spki.set(y, 27 + 32);

  return spki;
}

/**
 * Verifies rpIdHash and clientData origin/type/challenge.
 */
async function validateContext(params: {
  rpId: string;
  origin: string;
  expectedChallenge: Uint8Array;
  rpIdHash: Uint8Array;
  clientDataJSON: Uint8Array;
}): Promise<void> {
  const expectedRpIdHash = await sha256Bytes([toUtf8Bytes(params.rpId)]);
  if (!constantTimeEqual(params.rpIdHash, expectedRpIdHash)) {
    throw new Error('rpIdHash mismatch');
  }

  const clientData = JSON.parse(new TextDecoder().decode(params.clientDataJSON));
  if (clientData.type !== 'webauthn.create') {
    throw new Error('Invalid clientData type');
  }
  if (clientData.origin !== params.origin) {
    throw new Error('Invalid origin');
  }

  const challengeBytes = decodeBase64Url(clientData.challenge as string);
  if (!constantTimeEqual(challengeBytes, params.expectedChallenge)) {
    throw new Error('Challenge mismatch');
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return mismatch === 0;
}

/**
 * Verifies packed self-attestation signature.
 */
async function verifyPackedSelf(
  authDataRaw: Uint8Array,
  clientDataJSON: Uint8Array,
  attStmt: { sig: Uint8Array; x5c?: Uint8Array[] },
  pubKey: Uint8Array
): Promise<boolean> {
  const spki = coseKeyToSpki(pubKey);
  const cryptoApi = getCryptoApi();
  const key = await cryptoApi.subtle.importKey(
    'spki',
    toArrayBufferBytes(spki),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );

  const clientDataHash = await sha256Bytes([clientDataJSON]);
  const signatureData = new Uint8Array(authDataRaw.length + 32);
  signatureData.set(authDataRaw);
  signatureData.set(clientDataHash, authDataRaw.length);

  return cryptoApi.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    toArrayBufferBytes(attStmt.sig),
    toArrayBufferBytes(signatureData)
  );
}

/**
 * Verifies WebAuthn attestation.
 */
export async function verifyAttestation(params: {
  attestationObjectB64u: string;
  clientDataJSONB64u: string;
  expectedRpId: string;
  expectedOrigin: string;
  expectedChallenge: Uint8Array;
}): Promise<AttestationVerificationResult> {
  const decoded = decode(decodeBase64Url(params.attestationObjectB64u)) as {
    fmt: string;
    attStmt: { sig: Uint8Array; x5c?: Uint8Array[] };
    authData: Uint8Array;
  };
  const clientDataJSON = decodeBase64Url(params.clientDataJSONB64u);
  const authData = parseAuthenticatorData(decoded.authData);

  await validateContext({
    rpId: params.expectedRpId,
    origin: params.expectedOrigin,
    expectedChallenge: params.expectedChallenge,
    rpIdHash: authData.rpIdHash,
    clientDataJSON,
  });

  if (!(authData.flags & 0x01)) throw new Error('User presence flag not set');

  let verified = false;
  let warning: string | undefined;

  if (decoded.fmt === 'packed') {
    if (decoded.attStmt.x5c) {
      warning = 'Full x5c attestation not yet implemented';
    } else if (decoded.attStmt.sig && authData.credentialPublicKey) {
      verified = await verifyPackedSelf(
        decoded.authData,
        clientDataJSON,
        decoded.attStmt,
        authData.credentialPublicKey
      );
    }
  } else if (decoded.fmt !== 'none') {
    warning = `Attestation format ${decoded.fmt} not implemented`;
  }

  if (!authData.credentialId || !authData.credentialPublicKey) {
    throw new Error('Missing attested credential data');
  }

  return {
    verified,
    fmt: decoded.fmt,
    credentialId: encodeBase64Url(authData.credentialId) as Base64Url,
    publicKey: encodeBase64Url(authData.credentialPublicKey) as Base64Url,
    aaguid: encodeBase64Url(authData.aaguid || new Uint8Array(16)) as Base64Url,
    signCount: authData.signCount,
    warning,
  };
}
