import type { Base64Url, WrappedPrivateKey } from '@zerolink/shared';
import { AES_GCM, ARGON2ID } from '@zerolink/shared';
import { describe, expect, it } from 'vitest';
import { deserializeWrappedKeyCompact, serializeWrappedKeyCompact } from '../wrapped-key-codec';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWrappedKey(overrides?: Partial<WrappedPrivateKey>): WrappedPrivateKey {
  // encryptedKey: 154 bytes base64url (~206 chars)
  const encryptedKeyBytes = new Uint8Array(154).fill(0xab);
  const ivBytes = new Uint8Array(AES_GCM.IV_LENGTH).fill(0xcd);
  const saltBytes = new Uint8Array(ARGON2ID.SALT_LENGTH).fill(0xef);

  function toBase64Url(bytes: Uint8Array): Base64Url {
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '') as Base64Url;
  }

  const base: WrappedPrivateKey = {
    encryptedKey: toBase64Url(encryptedKeyBytes),
    iv: toBase64Url(ivBytes),
    kdf: {
      kdfType: 'argon2id',
      version: 19,
      m: ARGON2ID.MEMORY_COST_KB,
      t: ARGON2ID.TIME_COST,
      p: ARGON2ID.PARALLELISM,
      salt: toBase64Url(saltBytes),
    },
  };

  return { ...base, ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('serializeWrappedKeyCompact', () => {
  it('produces three dot-separated segments', () => {
    const wk = makeWrappedKey();
    const compact = serializeWrappedKeyCompact(wk);
    const parts = compact.split('.');
    expect(parts).toHaveLength(3);
  });

  it('first segment is encryptedKey', () => {
    const wk = makeWrappedKey();
    const compact = serializeWrappedKeyCompact(wk);
    expect(compact.split('.')[0]).toBe(wk.encryptedKey);
  });

  it('second segment is iv', () => {
    const wk = makeWrappedKey();
    const compact = serializeWrappedKeyCompact(wk);
    expect(compact.split('.')[1]).toBe(wk.iv);
  });

  it('third segment is salt', () => {
    const wk = makeWrappedKey();
    const compact = serializeWrappedKeyCompact(wk);
    expect(compact.split('.')[2]).toBe(wk.kdf.salt);
  });

  it('all segments are valid base64url characters', () => {
    const wk = makeWrappedKey();
    const compact = serializeWrappedKeyCompact(wk);
    for (const segment of compact.split('.')) {
      expect(segment).toMatch(/^[A-Za-z0-9_-]+$/u);
    }
  });

  it('throws when kdfType is not argon2id', () => {
    const wk = makeWrappedKey({
      kdf: {
        kdfType: 'argon2id',
        version: 19,
        m: 65536,
        t: 3,
        p: 1,
        salt: 'abc' as Base64Url,
      },
    });
    // Override kdfType to an unsupported value
    const badWk = { ...wk, kdf: { ...wk.kdf, kdfType: 'pbkdf2' } } as unknown as WrappedPrivateKey;
    expect(() => serializeWrappedKeyCompact(badWk)).toThrow();
  });
});

describe('deserializeWrappedKeyCompact', () => {
  it('round-trips a valid wrapped key', () => {
    const wk = makeWrappedKey();
    const compact = serializeWrappedKeyCompact(wk);
    const result = deserializeWrappedKeyCompact(compact);

    expect(result).not.toBeNull();
    expect(result!.encryptedKey).toBe(wk.encryptedKey);
    expect(result!.iv).toBe(wk.iv);
    expect(result!.kdf.salt).toBe(wk.kdf.salt);
  });

  it('reconstructs hardcoded KDF params from constants', () => {
    const wk = makeWrappedKey();
    const result = deserializeWrappedKeyCompact(serializeWrappedKeyCompact(wk));

    expect(result).not.toBeNull();
    expect(result!.kdf).toEqual({
      kdfType: 'argon2id',
      version: 19,
      m: ARGON2ID.MEMORY_COST_KB,
      t: ARGON2ID.TIME_COST,
      p: ARGON2ID.PARALLELISM,
      salt: wk.kdf.salt,
    });
  });

  it('returns null for empty string', () => {
    expect(deserializeWrappedKeyCompact('')).toBeNull();
  });

  it('returns null for fewer than 3 segments', () => {
    expect(deserializeWrappedKeyCompact('abc')).toBeNull();
    expect(deserializeWrappedKeyCompact('abc.def')).toBeNull();
  });

  it('returns null for more than 3 segments', () => {
    expect(deserializeWrappedKeyCompact('abc.def.ghi.jkl')).toBeNull();
  });

  it('returns null when IV decodes to wrong byte length', () => {
    const wk = makeWrappedKey();
    const parts = serializeWrappedKeyCompact(wk).split('.');
    // Replace IV with a base64url string that decodes to 8 bytes (wrong length)
    const shortIv = btoa(String.fromCharCode(...new Uint8Array(8)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '');
    const tampered = [parts[0], shortIv, parts[2]].join('.');
    expect(deserializeWrappedKeyCompact(tampered)).toBeNull();
  });

  it('returns null when salt decodes to wrong byte length', () => {
    const wk = makeWrappedKey();
    const parts = serializeWrappedKeyCompact(wk).split('.');
    // Replace salt with a base64url string that decodes to 8 bytes (wrong length)
    const shortSalt = btoa(String.fromCharCode(...new Uint8Array(8)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '');
    const tampered = [parts[0], parts[1], shortSalt].join('.');
    expect(deserializeWrappedKeyCompact(tampered)).toBeNull();
  });

  it('returns null when a segment contains non-base64url characters', () => {
    expect(deserializeWrappedKeyCompact('abc!.def.ghi')).toBeNull();
    expect(deserializeWrappedKeyCompact('abc.de+f.ghi')).toBeNull();
    expect(deserializeWrappedKeyCompact('abc.def.gh/i')).toBeNull();
  });

  it('returns null when encryptedKey is empty', () => {
    const wk = makeWrappedKey();
    const parts = serializeWrappedKeyCompact(wk).split('.');
    const tampered = ['', parts[1], parts[2]].join('.');
    expect(deserializeWrappedKeyCompact(tampered)).toBeNull();
  });
});
