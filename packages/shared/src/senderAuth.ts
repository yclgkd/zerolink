import { decode } from 'cborg';

import { DOMAIN } from './constants.ts';
import type {
  AttestationJSON,
  Base64Url,
  DecryptFetchWebAuthnDeliveryAuth,
  ECDSAPublicKeyJWK,
  HexString,
  UUID,
} from './types.ts';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/u;
const TEXT_ENCODER = new TextEncoder();

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
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): Base64Url {
  return btoa(bytesToBinary(bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '') as Base64Url;
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error('invalid base64url');
  }

  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return binaryToBytes(atob(padded));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function sha256Bytes(chunks: readonly Uint8Array[]): Promise<Uint8Array> {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(merged));
  return new Uint8Array(digest);
}

async function sha256Hex(chunks: readonly Uint8Array[]): Promise<HexString> {
  const digest = await sha256Bytes(chunks);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') as HexString;
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < a.byteLength; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }

  return mismatch === 0;
}

function getCoseCoordinates(decoded: Map<number, unknown> | Record<number, unknown>): {
  x: Uint8Array;
  y: Uint8Array;
} {
  const getValue = (key: number): unknown =>
    decoded instanceof Map ? decoded.get(key) : decoded[key];

  if (getValue(1) !== 2 || getValue(3) !== -7 || getValue(-1) !== 1) {
    throw new Error('unsupported COSE key format');
  }

  const x = getValue(-2);
  const y = getValue(-3);
  if (
    !(x instanceof Uint8Array) ||
    !(y instanceof Uint8Array) ||
    x.byteLength !== 32 ||
    y.byteLength !== 32
  ) {
    throw new Error('invalid COSE key coordinates');
  }

  return { x, y };
}

function parseAttestedCredentialPublicKey(authData: Uint8Array): Uint8Array {
  if (authData.byteLength < 55) {
    throw new Error('authenticator data too short');
  }

  const flags = authData[32] ?? 0;
  if ((flags & 0x40) === 0) {
    throw new Error('attested credential data missing');
  }

  const credentialIdLength = new DataView(authData.buffer, authData.byteOffset + 53, 2).getUint16(
    0,
    false
  );
  const credentialIdEnd = 55 + credentialIdLength;
  if (authData.byteLength <= credentialIdEnd) {
    throw new Error('credential public key missing');
  }

  return authData.slice(credentialIdEnd);
}

export function cosePublicKeyToSpkiBytes(cosePublicKey: Uint8Array): Uint8Array {
  const { x, y } = getCoseCoordinates(
    decode(cosePublicKey, { useMaps: true }) as Map<number, unknown>
  );

  const spki = new Uint8Array(91);
  spki.set([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04,
  ]);
  spki.set(x, 27);
  spki.set(y, 59);
  return spki;
}

export async function computeCredentialPublicKeyFingerprint(
  credentialPublicKeyB64u: Base64Url | string
): Promise<HexString> {
  return sha256Hex([cosePublicKeyToSpkiBytes(decodeBase64Url(credentialPublicKeyB64u))]);
}

export async function computeSoftkeyPublicKeyFingerprint(
  softkeyPubJwk: ECDSAPublicKeyJWK
): Promise<HexString> {
  const key = await crypto.subtle.importKey(
    'jwk',
    softkeyPubJwk as unknown as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', key));
  return sha256Hex([spki]);
}

export async function extractCredentialPublicKeyFromAttestation(
  attestationObjectB64u: Base64Url | string
): Promise<Base64Url> {
  const decoded = decode(decodeBase64Url(attestationObjectB64u)) as {
    authData: Uint8Array;
  };
  return encodeBase64Url(parseAttestedCredentialPublicKey(decoded.authData));
}

export async function computeSenderAuthFingerprintFromAttestation(
  attestation: AttestationJSON
): Promise<HexString> {
  const credentialPublicKey = await extractCredentialPublicKeyFromAttestation(
    attestation.response.attestationObject
  );
  return computeCredentialPublicKeyFingerprint(credentialPublicKey);
}

export function buildShareUrlWithFragment(
  shareUrl: string,
  lockSecretB64u: Base64Url | string,
  senderAuthFpr?: HexString | string
): string {
  const hashIndex = shareUrl.indexOf('#');
  const base = hashIndex >= 0 ? shareUrl.slice(0, hashIndex) : shareUrl;
  const params = new URLSearchParams();
  params.set('k', lockSecretB64u);
  if (senderAuthFpr) {
    params.set('af', senderAuthFpr);
  }
  return `${base}#${params.toString()}`;
}

export function buildManageUrlWithFragment(manageUrl: string, wrappedKeyCompact: string): string {
  const hashIndex = manageUrl.indexOf('#');
  const base = hashIndex >= 0 ? manageUrl.slice(0, hashIndex) : manageUrl;
  const params = new URLSearchParams();
  params.set('wk', wrappedKeyCompact);
  return `${base}#${params.toString()}`;
}

export function parseManageFragment(hash: string): { wrappedKeyCompact: string | null } {
  const normalized = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!normalized) return { wrappedKeyCompact: null };
  const params = new URLSearchParams(normalized);
  const wk = params.get('wk');
  return { wrappedKeyCompact: wk || null };
}

export function parseShareFragment(hash: string): {
  lockSecretB64u: Base64Url | null;
  senderAuthFpr: HexString | null;
} {
  const normalized = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(normalized);
  const lockSecret = params.get('k');
  const senderAuthFpr = params.get('af');

  return {
    lockSecretB64u:
      lockSecret && BASE64URL_PATTERN.test(lockSecret) ? (lockSecret as Base64Url) : null,
    senderAuthFpr:
      senderAuthFpr && HEX_64_PATTERN.test(senderAuthFpr) ? (senderAuthFpr as HexString) : null,
  };
}

export async function deriveUpdateProofChallengeB64u({
  uuid,
  intentHash,
}: {
  uuid: UUID | string;
  intentHash: HexString | string;
}): Promise<Base64Url> {
  return encodeBase64Url(
    await sha256Bytes([
      TEXT_ENCODER.encode(DOMAIN.DELIVERY_PROOF),
      TEXT_ENCODER.encode(uuid),
      TEXT_ENCODER.encode(intentHash),
    ])
  );
}

function copyPadded(
  src: Uint8Array,
  dst: Uint8Array,
  dstOffset: number,
  fieldLength: number
): void {
  let srcOffset = 0;
  let srcLength = src.byteLength;
  while (srcLength > fieldLength && src[srcOffset] === 0) {
    srcOffset += 1;
    srcLength -= 1;
  }

  if (srcLength > fieldLength) {
    throw new Error('invalid DER integer component');
  }

  dst.set(src.subarray(srcOffset, srcOffset + srcLength), dstOffset + (fieldLength - srcLength));
}

function derToP1363(derSig: Uint8Array): Uint8Array {
  if (derSig[0] !== 0x30) {
    throw new Error('invalid DER signature');
  }

  let offset = 2;
  if (derSig[offset] !== 0x02) {
    throw new Error('invalid DER signature');
  }
  offset += 1;
  const rLength = derSig[offset] ?? 0;
  offset += 1;
  const rBytes = derSig.slice(offset, offset + rLength);
  offset += rLength;

  if (derSig[offset] !== 0x02) {
    throw new Error('invalid DER signature');
  }
  offset += 1;
  const sLength = derSig[offset] ?? 0;
  offset += 1;
  const sBytes = derSig.slice(offset, offset + sLength);

  const result = new Uint8Array(64);
  copyPadded(rBytes, result, 0, 32);
  copyPadded(sBytes, result, 32, 32);
  return result;
}

function normalizeP1363Signature(signature: Uint8Array): Uint8Array {
  return signature.byteLength === 64 ? signature : derToP1363(signature);
}

export async function verifyWebAuthnDeliveryProof(params: {
  deliveryAuth: DecryptFetchWebAuthnDeliveryAuth;
  expectedChallenge: Base64Url | string;
  rpId: string;
  rpOrigin: string;
}): Promise<boolean> {
  const { deliveryAuth, expectedChallenge, rpId, rpOrigin } = params;
  const clientDataBytes = decodeBase64Url(deliveryAuth.proof.clientDataJSON);

  let clientData: { type?: string; challenge?: string; origin?: string };
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };
  } catch {
    return false;
  }

  if (
    clientData.type !== 'webauthn.get' ||
    clientData.challenge !== expectedChallenge ||
    clientData.origin !== rpOrigin
  ) {
    return false;
  }

  const authData = decodeBase64Url(deliveryAuth.proof.authenticatorData);
  if (authData.byteLength < 37) {
    return false;
  }

  const expectedRpIdHash = await sha256Bytes([TEXT_ENCODER.encode(rpId)]);
  if (!constantTimeEqualBytes(authData.slice(0, 32), expectedRpIdHash)) {
    return false;
  }

  const flags = authData[32] ?? 0;
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0) {
    return false;
  }

  const clientDataHash = await sha256Bytes([clientDataBytes]);
  const signedData = new Uint8Array(authData.byteLength + clientDataHash.byteLength);
  signedData.set(authData, 0);
  signedData.set(clientDataHash, authData.byteLength);

  const coseKey = decode(decodeBase64Url(deliveryAuth.signer.publicKey), { useMaps: true }) as Map<
    number,
    unknown
  >;
  const x = coseKey.get(-2);
  const y = coseKey.get(-3);
  const alg = coseKey.get(3);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || alg !== -7) {
    return false;
  }

  const publicKey = await crypto.subtle.importKey(
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

  const signature = normalizeP1363Signature(decodeBase64Url(deliveryAuth.proof.signature));
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    toArrayBuffer(signature),
    toArrayBuffer(signedData)
  );
}

export async function verifySoftkeyDeliveryProof(params: {
  softkeyPubJwk: ECDSAPublicKeyJWK;
  signatureHex: HexString | string;
  expectedChallengeBytes: Uint8Array;
}): Promise<boolean> {
  const { softkeyPubJwk, signatureHex, expectedChallengeBytes } = params;
  if (signatureHex.length !== 128 || !/^[0-9a-f]+$/u.test(signatureHex)) {
    return false;
  }

  const signatureBytes = new Uint8Array(64);
  for (let index = 0; index < signatureHex.length; index += 2) {
    const parsedByte = Number.parseInt(signatureHex.slice(index, index + 2), 16);
    if (Number.isNaN(parsedByte)) {
      return false;
    }
    signatureBytes[index / 2] = parsedByte;
  }

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    softkeyPubJwk as unknown as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(expectedChallengeBytes)
  );
}
