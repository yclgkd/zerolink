import type { Base64Url, HexString, UnixMs } from '@zerolink/shared';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const encoder = new TextEncoder();

export function asUnixMs(value: number): UnixMs {
  return value as UnixMs;
}

export function getCryptoApi(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('WebCrypto is not available');
  }
  return cryptoApi;
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

export function bytesToHex(bytes: Uint8Array): HexString {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') as HexString;
}

export function bytesToBinary(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return binary;
}

export function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function encodeBase64Url(bytes: Uint8Array): Base64Url {
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

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

export function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

export async function sha256Hex(chunks: readonly Uint8Array[]): Promise<HexString> {
  const cryptoApi = getCryptoApi();
  const merged = concatBytes(chunks);
  const digest = await cryptoApi.subtle.digest('SHA-256', toArrayBufferBytes(merged));
  return bytesToHex(new Uint8Array(digest));
}

export async function sha256Bytes(chunks: readonly Uint8Array[]): Promise<Uint8Array> {
  const cryptoApi = getCryptoApi();
  const merged = concatBytes(chunks);
  const digest = await cryptoApi.subtle.digest('SHA-256', toArrayBufferBytes(merged));
  return new Uint8Array(digest);
}

export function toUtf8Bytes(value: string): Uint8Array {
  return encoder.encode(value);
}
