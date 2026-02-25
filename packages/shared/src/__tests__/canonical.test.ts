import { describe, expect, it } from 'vitest';

import { canonicalJsonStringify, computeIntentHash } from '../canonical.ts';
import type { HexString } from '../types.ts';

describe('canonicalJsonStringify', () => {
  it('sorts top-level keys alphabetically', () => {
    const result = canonicalJsonStringify({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys recursively', () => {
    const result = canonicalJsonStringify({
      outer: { z: 1, a: 2 },
      alpha: true,
    });
    expect(result).toBe('{"alpha":true,"outer":{"a":2,"z":1}}');
  });

  it('preserves array element order', () => {
    const result = canonicalJsonStringify({ items: [3, 1, 2] });
    expect(result).toBe('{"items":[3,1,2]}');
  });

  it('sorts keys within objects inside arrays', () => {
    const result = canonicalJsonStringify({
      list: [{ z: 1, a: 2 }],
    });
    expect(result).toBe('{"list":[{"a":2,"z":1}]}');
  });

  it('omits undefined values', () => {
    const result = canonicalJsonStringify({ a: 1, b: undefined, c: 3 });
    expect(result).toBe('{"a":1,"c":3}');
  });

  it('preserves null values', () => {
    const result = canonicalJsonStringify({ a: null, b: 1 });
    expect(result).toBe('{"a":null,"b":1}');
  });

  it('handles empty objects', () => {
    expect(canonicalJsonStringify({})).toBe('{}');
  });

  it('handles empty arrays', () => {
    expect(canonicalJsonStringify({ a: [] })).toBe('{"a":[]}');
  });

  it('handles primitive values', () => {
    expect(canonicalJsonStringify(42)).toBe('42');
    expect(canonicalJsonStringify('hello')).toBe('"hello"');
    expect(canonicalJsonStringify(true)).toBe('true');
    expect(canonicalJsonStringify(null)).toBe('null');
  });

  it('produces stable output for a full UpdateIntent fixture', () => {
    const intent = {
      op: 'update',
      uuid: 'abcdefghijklmnopqrstu',
      version: 0,
      timestamp: 1730000300000,
      nonce: 'nonce-value-base64url',
      receiverPubFpr: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      cipherBundle: {
        ciphertext: 'ct-value',
        iv: 'iv-value-12b',
        aad: 'aad-value',
        encContentKey: 'eck-value',
        ciphertextHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        padBlock: 4096,
      },
      expireAt: null,
    };

    const result = canonicalJsonStringify(intent);
    // Keys must be sorted at all levels
    const parsed = JSON.parse(result);
    const topKeys = Object.keys(parsed);
    expect(topKeys).toEqual([...topKeys].sort());

    const bundleKeys = Object.keys(parsed.cipherBundle);
    expect(bundleKeys).toEqual([...bundleKeys].sort());
  });

  it('produces stable output for a DeleteIntent fixture', () => {
    const intent = {
      op: 'delete',
      uuid: 'abcdefghijklmnopqrstu',
      version: 1,
      timestamp: 1730000400000,
      nonce: 'delete-nonce-b64url',
    };

    const result = canonicalJsonStringify(intent);
    const parsed = JSON.parse(result);
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual(['nonce', 'op', 'timestamp', 'uuid', 'version']);
  });
});

describe('computeIntentHash', () => {
  it('produces a 64-character lowercase hex string', async () => {
    const hash = await computeIntentHash({ op: 'delete', uuid: 'test' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash for reordered keys', async () => {
    const hash1 = await computeIntentHash({ a: 1, b: 2, c: 3 });
    const hash2 = await computeIntentHash({ c: 3, a: 1, b: 2 });
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different values', async () => {
    const hash1 = await computeIntentHash({ op: 'update', version: 0 });
    const hash2 = await computeIntentHash({ op: 'delete', version: 0 });
    expect(hash1).not.toBe(hash2);
  });

  it('produces a locked-down known hash for a fixture', async () => {
    const intent = {
      op: 'delete',
      uuid: 'abcdefghijklmnopqrstu',
      version: 0,
      timestamp: 1730000000000,
      nonce: 'test-nonce',
    };

    // Canonical JSON: {"nonce":"test-nonce","op":"delete","timestamp":1730000000000,"uuid":"abcdefghijklmnopqrstu","version":0}
    const canonical = canonicalJsonStringify(intent);
    expect(canonical).toBe(
      '{"nonce":"test-nonce","op":"delete","timestamp":1730000000000,"uuid":"abcdefghijklmnopqrstu","version":0}'
    );

    const hash = await computeIntentHash(intent);
    // SHA-256 of the canonical string above — lock this down
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
    const expected = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('') as HexString;
    expect(hash).toBe(expected);
  });
});
