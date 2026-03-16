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

let cachedProbe: Promise<boolean> | null = null;

async function probeNativeEd25519(spkiBytes: Uint8Array): Promise<boolean> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return false;
  try {
    await crypto.subtle.importKey('spki', toArrayBuffer(spkiBytes), { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return true;
  } catch {
    return false;
  }
}

function getOrProbeNativeSupport(spkiBytes: Uint8Array): Promise<boolean> {
  if (cachedProbe === null) {
    cachedProbe = probeNativeEd25519(spkiBytes);
  }
  return cachedProbe;
}

/** Resets the Ed25519 capability probe cache. Call in afterEach for test isolation. */
export function resetProbeCache(): void {
  cachedProbe = null;
}

// ─── Noble fallback ───────────────────────────────────────────────────────────

async function verifyWithNoble(
  manifestBytes: Uint8Array,
  signatureBytes: Uint8Array,
  rawPublicKeyBytes: Uint8Array
): Promise<boolean> {
  // Pre-validate lengths to normalize malformed-input errors to `false` rather than throwing.
  // Noble's verifyAsync throws for wrong-length inputs (abytes validation outside its try-catch).
  // Other throws (e.g. "crypto.subtle must be defined") are allowed to propagate so that
  // verification.ts can surface them as `crypto_unavailable`.
  if (signatureBytes.byteLength !== 64 || rawPublicKeyBytes.byteLength !== 32) {
    return false;
  }
  const { verifyAsync } = await import('@noble/ed25519');
  return verifyAsync(signatureBytes, manifestBytes, rawPublicKeyBytes);
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
  const isNative = await getOrProbeNativeSupport(spkiBytes);

  if (isNative) {
    try {
      const publicKey = await crypto.subtle.importKey(
        'spki',
        toArrayBuffer(spkiBytes),
        { name: 'Ed25519' },
        false,
        ['verify']
      );
      return await crypto.subtle.verify(
        { name: 'Ed25519' },
        publicKey,
        toArrayBuffer(signatureBytes),
        toArrayBuffer(manifestBytes)
      );
    } catch {
      // Unexpected failure after the probe succeeded. Normalize to false so that
      // callers see `signature_invalid` rather than an unhandled rejection.
      return false;
    }
  }

  // Noble fallback: extract raw public key from SPKI and verify using pure JS.
  const rawPublicKey = spkiToRawEd25519(spkiBytes);
  return verifyWithNoble(manifestBytes, signatureBytes, rawPublicKey);
}

export async function computePublicKeyFingerprint(publicKeyPem: string): Promise<string> {
  return sha256Hex(pemToSpkiBytes(publicKeyPem));
}
