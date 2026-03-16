import * as fallbackVerifier from './ed25519-fallback';

function decodeBase64(base64: string): Uint8Array {
  const normalized = atob(base64);
  return Uint8Array.from(normalized, (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return decodeBase64(normalized);
}

export function pemToSpkiBytes(publicKeyPem: string): Uint8Array {
  const base64 = publicKeyPem
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/gu, '')
    .replace(/\s+/gu, '');
  return decodeBase64(base64);
}

// Ed25519 SPKI DER = fixed 12-byte ASN.1 header (OID id-EdDSA) + 32-byte raw public key
const ED25519_SPKI_HEADER = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);
const ED25519_SPKI_LENGTH = 44; // 12 header + 32 key

export function spkiToRawEd25519(spkiBytes: Uint8Array): Uint8Array {
  if (spkiBytes.byteLength !== ED25519_SPKI_LENGTH) {
    throw new Error(
      `Ed25519 SPKI key must be ${ED25519_SPKI_LENGTH} bytes, got ${spkiBytes.byteLength}`
    );
  }
  for (let i = 0; i < ED25519_SPKI_HEADER.length; i++) {
    if (spkiBytes[i] !== ED25519_SPKI_HEADER[i]) {
      throw new Error('Ed25519 SPKI header mismatch – key is not a valid Ed25519 SPKI public key');
    }
  }
  return spkiBytes.slice(12);
}

export async function sha256Hex(input: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ─── Probe & Memoization ──────────────────────────────────────────────────────

type VerifierMode = 'native' | 'fallback';

let cachedVerifierMode: Promise<VerifierMode> | null = null;

async function probeVerifierMode(spkiBytes: Uint8Array): Promise<VerifierMode> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return 'fallback';
  try {
    await crypto.subtle.importKey('spki', toArrayBuffer(spkiBytes), { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return 'native';
  } catch {
    return 'fallback';
  }
}

function getOrProbeVerifierMode(spkiBytes: Uint8Array): Promise<VerifierMode> {
  if (cachedVerifierMode === null) {
    cachedVerifierMode = probeVerifierMode(spkiBytes);
  }
  return cachedVerifierMode;
}

function forceFallbackMode(): void {
  cachedVerifierMode = Promise.resolve('fallback');
}

/** Resets the Ed25519 verifier-mode cache. Call in afterEach for test isolation. */
export function resetProbeCache(): void {
  cachedVerifierMode = null;
}

// ─── Noble fallback ───────────────────────────────────────────────────────────

async function verifyWithNoble(
  manifestBytes: Uint8Array,
  signatureBytes: Uint8Array,
  rawPublicKeyBytes: Uint8Array
): Promise<boolean> {
  return fallbackVerifier.verifyEd25519Signature({
    manifestBytes,
    rawPublicKeyBytes,
    signatureBytes,
  });
}

async function verifyWithNative(
  manifestBytes: Uint8Array,
  signatureBytes: Uint8Array,
  spkiBytes: Uint8Array
): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    'spki',
    toArrayBuffer(spkiBytes),
    { name: 'Ed25519' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(manifestBytes)
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function verifyManifestSignature(opts: {
  manifestBytes: Uint8Array;
  publicKeyPem: string;
  signatureBase64Url: string;
}): Promise<boolean> {
  const { manifestBytes, publicKeyPem, signatureBase64Url } = opts;
  const spkiBytes = pemToSpkiBytes(publicKeyPem);
  const signatureBytes = base64UrlToBytes(signatureBase64Url);
  const verifierMode = await getOrProbeVerifierMode(spkiBytes);

  if (verifierMode === 'native') {
    try {
      return await verifyWithNative(manifestBytes, signatureBytes, spkiBytes);
    } catch {
      forceFallbackMode();
    }
  }

  // Raw key extraction is deferred to the fallback path: spkiToRawEd25519 validates
  // the Ed25519 SPKI header and would throw on unrecognised key formats, which should
  // propagate as a caller error rather than being silently absorbed here.
  return verifyWithNoble(manifestBytes, signatureBytes, spkiToRawEd25519(spkiBytes));
}

export async function computePublicKeyFingerprint(publicKeyPem: string): Promise<string> {
  return sha256Hex(pemToSpkiBytes(publicKeyPem));
}
