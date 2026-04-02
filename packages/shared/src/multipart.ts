import { AES_GCM } from './constants.ts';
import type { UUID } from './types.ts';

const chunkLabelBytes = new TextEncoder().encode('chunk');

function encodeUint32BigEndian(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('chunk index must be a uint32');
  }

  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function encodeUint96FromUint32(value: number): Uint8Array {
  const bytes = new Uint8Array(AES_GCM.IV_LENGTH);
  new DataView(bytes.buffer).setUint32(bytes.byteLength - 4, value, false);
  return bytes;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
}

export function buildMultipartChunkAadBytes(input: {
  channelUuid: UUID | string;
  index: number;
}): Uint8Array {
  return concatBytes([
    new TextEncoder().encode(input.channelUuid),
    chunkLabelBytes,
    encodeUint32BigEndian(input.index),
  ]);
}

export function deriveMultipartChunkIv(baseIv: Uint8Array, index: number): Uint8Array {
  if (baseIv.byteLength !== AES_GCM.IV_LENGTH) {
    throw new Error(`base IV must be ${AES_GCM.IV_LENGTH} bytes`);
  }

  const derived = baseIv.slice();
  const counter = encodeUint96FromUint32(index);
  for (let offset = 0; offset < derived.byteLength; offset += 1) {
    derived[offset] = (derived[offset] ?? 0) ^ (counter[offset] ?? 0);
  }
  return derived;
}

export function resolveMultipartChunkCount(
  totalPlaintextBytes: number,
  chunkSizeBytes: number
): number {
  if (!Number.isInteger(totalPlaintextBytes) || totalPlaintextBytes <= 0) {
    throw new Error('totalPlaintextBytes must be a positive integer');
  }
  if (!Number.isInteger(chunkSizeBytes) || chunkSizeBytes <= 0) {
    throw new Error('chunkSizeBytes must be a positive integer');
  }

  return Math.ceil(totalPlaintextBytes / chunkSizeBytes);
}

export function resolveMultipartCiphertextBytes(plaintextBytes: number): number {
  if (!Number.isInteger(plaintextBytes) || plaintextBytes < 0) {
    throw new Error('plaintextBytes must be a non-negative integer');
  }
  return plaintextBytes + AES_GCM.TAG_LENGTH_BITS / 8;
}
