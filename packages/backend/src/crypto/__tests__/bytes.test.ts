import { describe, expect, it } from 'vitest';

import {
  binaryToBytes,
  bytesToBinary,
  bytesToHex,
  concatBytes,
  constantTimeEqual,
  decodeBase64Url,
  encodeBase64Url,
  sha256Bytes,
  sha256Hex,
  toUtf8Bytes,
} from '../bytes.ts';

describe('bytes crypto utilities', () => {
  it('round-trips base64url encoding and decoding', () => {
    const original = new Uint8Array([0, 1, 2, 255, 254, 253]);
    const encoded = encodeBase64Url(original);
    const decoded = decodeBase64Url(encoded);

    expect(decoded).toEqual(original);
  });

  it('encodes empty bytes to empty string', () => {
    expect(encodeBase64Url(new Uint8Array([]))).toBe('');
  });

  it('rejects invalid base64url characters', () => {
    expect(() => decodeBase64Url('abc+def')).toThrow('invalid base64url');
    expect(() => decodeBase64Url('abc/def')).toThrow('invalid base64url');
    expect(() => decodeBase64Url('abc=def')).toThrow('invalid base64url');
  });

  it('round-trips binary conversion', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]);
    const binary = bytesToBinary(original);
    const restored = binaryToBytes(binary);

    expect(restored).toEqual(original);
  });

  it('converts bytes to hex correctly', () => {
    const bytes = new Uint8Array([0x00, 0x0a, 0xff, 0xde, 0xad]);
    expect(bytesToHex(bytes)).toBe('000affdead');
  });

  it('concatenates byte arrays', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3]);
    const c = new Uint8Array([4, 5, 6]);
    const result = concatBytes([a, b, c]);

    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('concatenates empty arrays', () => {
    expect(concatBytes([])).toEqual(new Uint8Array([]));
  });

  it('produces correct SHA-256 hex for known input', async () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const result = await sha256Hex([new Uint8Array([])]);
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('sha256Bytes returns raw 32-byte digest', async () => {
    const result = await sha256Bytes([new Uint8Array([])]);
    expect(result.byteLength).toBe(32);
    // First two bytes of SHA-256("") are 0xe3, 0xb0
    expect(result[0]).toBe(0xe3);
    expect(result[1]).toBe(0xb0);
  });

  it('sha256Hex concatenates multiple chunks', async () => {
    // SHA-256("ab") vs SHA-256 of two separate chunks
    const single = await sha256Hex([toUtf8Bytes('ab')]);
    const multi = await sha256Hex([toUtf8Bytes('a'), toUtf8Bytes('b')]);
    expect(single).toBe(multi);
  });

  it('constantTimeEqual returns true for matching strings', () => {
    expect(constantTimeEqual('hello', 'hello')).toBe(true);
  });

  it('constantTimeEqual returns false for non-matching strings', () => {
    expect(constantTimeEqual('hello', 'world')).toBe(false);
  });

  it('constantTimeEqual returns false for different-length strings', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('toUtf8Bytes encodes string to UTF-8', () => {
    const bytes = toUtf8Bytes('AB');
    expect(bytes).toEqual(new Uint8Array([0x41, 0x42]));
  });
});
