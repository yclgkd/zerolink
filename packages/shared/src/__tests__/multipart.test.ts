import { describe, expect, it } from 'vitest';

import { AES_GCM } from '../constants.ts';
import {
  buildMultipartChunkAadBytes,
  concatBytes,
  deriveMultipartChunkIv,
  resolveMultipartChunkCount,
  resolveMultipartCiphertextBytes,
} from '../multipart.ts';

describe('concatBytes', () => {
  it('joins byte arrays in order', () => {
    expect(
      concatBytes([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])])
    ).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });
});

describe('buildMultipartChunkAadBytes', () => {
  it('binds the channel uuid and chunk index into the AAD bytes', () => {
    const aadBytes = buildMultipartChunkAadBytes({
      channelUuid: 'channel-123',
      index: 7,
    });

    expect(Array.from(aadBytes)).toEqual([
      ...Array.from(new TextEncoder().encode('channel-123chunk')),
      0,
      0,
      0,
      7,
    ]);
  });
});

describe('deriveMultipartChunkIv', () => {
  it('xor-derives the last uint32 of the IV with the chunk index', () => {
    const baseIv = new Uint8Array(AES_GCM.IV_LENGTH).fill(0xaa);

    expect(deriveMultipartChunkIv(baseIv, 1)).toEqual(
      new Uint8Array([0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xab])
    );
    expect(baseIv).toEqual(new Uint8Array(AES_GCM.IV_LENGTH).fill(0xaa));
  });

  it('rejects IVs that are not 96 bits', () => {
    expect(() => deriveMultipartChunkIv(new Uint8Array(8), 0)).toThrow(
      `base IV must be ${AES_GCM.IV_LENGTH} bytes`
    );
  });
});

describe('resolveMultipartChunkCount', () => {
  it('rounds up to cover the tail chunk', () => {
    expect(resolveMultipartChunkCount(17, 8)).toBe(3);
  });

  it('rejects invalid totals and chunk sizes', () => {
    expect(() => resolveMultipartChunkCount(0, 8)).toThrow(
      'totalPlaintextBytes must be a positive integer'
    );
    expect(() => resolveMultipartChunkCount(8, 0)).toThrow(
      'chunkSizeBytes must be a positive integer'
    );
  });
});

describe('resolveMultipartCiphertextBytes', () => {
  it('adds one AES-GCM tag per chunk payload', () => {
    expect(resolveMultipartCiphertextBytes(32)).toBe(32 + AES_GCM.TAG_LENGTH_BITS / 8);
  });

  it('rejects negative plaintext lengths', () => {
    expect(() => resolveMultipartCiphertextBytes(-1)).toThrow(
      'plaintextBytes must be a non-negative integer'
    );
  });
});
