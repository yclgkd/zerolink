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

export async function sha256Hex(input: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyManifestSignature(opts: {
  manifestBytes: Uint8Array;
  publicKeyPem: string;
  signatureBase64Url: string;
}): Promise<boolean> {
  const { manifestBytes, publicKeyPem, signatureBase64Url } = opts;
  const publicKey = await crypto.subtle.importKey(
    'spki',
    toArrayBuffer(pemToSpkiBytes(publicKeyPem)),
    { name: 'Ed25519' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    toArrayBuffer(base64UrlToBytes(signatureBase64Url)),
    toArrayBuffer(manifestBytes)
  );
}

export async function computePublicKeyFingerprint(publicKeyPem: string): Promise<string> {
  return sha256Hex(pemToSpkiBytes(publicKeyPem));
}
