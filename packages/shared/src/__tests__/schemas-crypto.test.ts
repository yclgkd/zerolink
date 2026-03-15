import { describe, expect, it } from 'vitest';

import {
  Argon2idParamsSchema,
  AssertionJSONSchema,
  AttestationJSONSchema,
  CipherBundleSchema,
  ECDSAPublicKeyJWKSchema,
  KdfParamsSchema,
  Pbkdf2ParamsSchema,
  RSAPublicKeyJWKSchema,
  SafetyCodeColorSchema,
  SafetyCodeEmojiSchema,
  SafetyCodeSchema,
  StoredCredentialSchema,
  WrappedPrivateKeySchema,
} from '../schemas.ts';

import {
  b64,
  validAssertion,
  validAttestation,
  validCipherBundle,
  validEcdsaJwk,
  validJwk,
} from './helpers/schema-fixtures.ts';

describe('schemas - crypto', () => {
  // ─── RSAPublicKeyJWK Schema ─────────────────────────────────────────────────

  describe('RSAPublicKeyJWKSchema', () => {
    it('accepts a valid JWK', () => {
      expect(RSAPublicKeyJWKSchema.parse(validJwk)).toMatchObject({ kty: 'RSA' });
    });

    it('rejects wrong kty', () => {
      expect(() => RSAPublicKeyJWKSchema.parse({ ...validJwk, kty: 'EC' })).toThrow();
    });

    it('rejects wrong alg', () => {
      expect(() => RSAPublicKeyJWKSchema.parse({ ...validJwk, alg: 'RSA-OAEP' })).toThrow();
    });

    it('rejects ext:false', () => {
      expect(() => RSAPublicKeyJWKSchema.parse({ ...validJwk, ext: false })).toThrow();
    });

    it('rejects wrong key_ops', () => {
      expect(() => RSAPublicKeyJWKSchema.parse({ ...validJwk, key_ops: ['decrypt'] })).toThrow();
    });
  });

  // ─── ECDSAPublicKeyJWK Schema ───────────────────────────────────────────────

  describe('ECDSAPublicKeyJWKSchema', () => {
    it('accepts a valid ECDSA P-256 JWK', () => {
      const result = ECDSAPublicKeyJWKSchema.parse(validEcdsaJwk);
      expect(result.kty).toBe('EC');
      expect(result.crv).toBe('P-256');
    });

    it('rejects wrong kty', () => {
      expect(() => ECDSAPublicKeyJWKSchema.parse({ ...validEcdsaJwk, kty: 'RSA' })).toThrow();
    });

    it('rejects wrong crv', () => {
      expect(() => ECDSAPublicKeyJWKSchema.parse({ ...validEcdsaJwk, crv: 'P-384' })).toThrow();
    });

    it('rejects wrong key_ops', () => {
      expect(() =>
        ECDSAPublicKeyJWKSchema.parse({ ...validEcdsaJwk, key_ops: ['sign'] })
      ).toThrow();
    });

    it('rejects x with padding character', () => {
      expect(() => ECDSAPublicKeyJWKSchema.parse({ ...validEcdsaJwk, x: 'abc=' })).toThrow();
    });
  });

  // ─── KDF Parameter Schemas ──────────────────────────────────────────────────

  describe('Argon2idParamsSchema', () => {
    const valid = {
      kdfType: 'argon2id',
      version: 19,
      m: 65536,
      t: 3,
      p: 1,
      salt: b64,
    };

    it('accepts valid argon2id params', () => {
      expect(Argon2idParamsSchema.parse(valid)).toMatchObject({
        kdfType: 'argon2id',
        version: 19,
      });
    });

    it('rejects version != 19', () => {
      expect(() => Argon2idParamsSchema.parse({ ...valid, version: 18 })).toThrow();
    });

    it('rejects m < 1', () => {
      expect(() => Argon2idParamsSchema.parse({ ...valid, m: 0 })).toThrow();
    });
  });

  describe('Pbkdf2ParamsSchema', () => {
    const valid = { kdfType: 'pbkdf2', iterations: 600_000, salt: b64 };

    it('accepts valid PBKDF2 params', () => {
      expect(Pbkdf2ParamsSchema.parse(valid)).toMatchObject({
        kdfType: 'pbkdf2',
      });
    });

    it('rejects iterations below 600 000', () => {
      expect(() => Pbkdf2ParamsSchema.parse({ ...valid, iterations: 599_999 })).toThrow();
    });
  });

  describe('KdfParamsSchema (discriminatedUnion)', () => {
    it('selects argon2id variant by kdfType', () => {
      const result = KdfParamsSchema.parse({
        kdfType: 'argon2id',
        version: 19,
        m: 65536,
        t: 3,
        p: 1,
        salt: b64,
      });
      expect(result.kdfType).toBe('argon2id');
    });

    it('selects pbkdf2 variant by kdfType', () => {
      const result = KdfParamsSchema.parse({
        kdfType: 'pbkdf2',
        iterations: 600_000,
        salt: b64,
      });
      expect(result.kdfType).toBe('pbkdf2');
    });

    it('rejects unknown kdfType', () => {
      expect(() => KdfParamsSchema.parse({ kdfType: 'scrypt', n: 32768, salt: b64 })).toThrow();
    });
  });

  // ─── WrappedPrivateKey Schema ───────────────────────────────────────────────

  describe('WrappedPrivateKeySchema', () => {
    it('accepts a valid wrapped key with argon2id', () => {
      const result = WrappedPrivateKeySchema.parse({
        encryptedKey: b64,
        iv: b64,
        kdf: {
          kdfType: 'argon2id',
          version: 19,
          m: 65536,
          t: 3,
          p: 1,
          salt: b64,
        },
      });
      expect(result.kdf.kdfType).toBe('argon2id');
    });

    it('accepts a valid wrapped key with pbkdf2', () => {
      const result = WrappedPrivateKeySchema.parse({
        encryptedKey: b64,
        iv: b64,
        kdf: { kdfType: 'pbkdf2', iterations: 600_000, salt: b64 },
      });
      expect(result.kdf.kdfType).toBe('pbkdf2');
    });

    it('rejects missing kdf', () => {
      expect(() => WrappedPrivateKeySchema.parse({ encryptedKey: b64, iv: b64 })).toThrow();
    });
  });

  // ─── CipherBundle Schema ────────────────────────────────────────────────────

  describe('CipherBundleSchema', () => {
    it('accepts a valid cipher bundle', () => {
      expect(CipherBundleSchema.parse(validCipherBundle)).toMatchObject({
        padBlock: 4096,
      });
    });

    it('rejects uppercase hex in ciphertextHash', () => {
      expect(() =>
        CipherBundleSchema.parse({
          ...validCipherBundle,
          ciphertextHash: 'DEADBEEF',
        })
      ).toThrow();
    });

    it('rejects padBlock = 0', () => {
      expect(() => CipherBundleSchema.parse({ ...validCipherBundle, padBlock: 0 })).toThrow();
    });

    it('rejects padBlock > 65536', () => {
      expect(() => CipherBundleSchema.parse({ ...validCipherBundle, padBlock: 65537 })).toThrow();
    });

    it('rejects missing ciphertext', () => {
      const { ciphertext: _, ...rest } = validCipherBundle;
      expect(() => CipherBundleSchema.parse(rest)).toThrow();
    });
  });

  // ─── Safety Code Schemas ────────────────────────────────────────────────────

  describe('SafetyCodeEmojiSchema', () => {
    const validEmoji = {
      type: 'emoji' as const,
      emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼'] as const,
    };

    it('accepts exactly 8 emojis', () => {
      expect(SafetyCodeEmojiSchema.parse(validEmoji)).toMatchObject({
        type: 'emoji',
      });
    });

    it('rejects 7 emojis (tuple too short)', () => {
      expect(() =>
        SafetyCodeEmojiSchema.parse({
          ...validEmoji,
          emojis: validEmoji.emojis.slice(0, 7),
        })
      ).toThrow();
    });

    it('rejects 9 emojis (tuple too long)', () => {
      expect(() =>
        SafetyCodeEmojiSchema.parse({
          ...validEmoji,
          emojis: [...validEmoji.emojis, '🐯'],
        })
      ).toThrow();
    });
  });

  describe('SafetyCodeColorSchema', () => {
    const validColor = {
      type: 'color' as const,
      cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const,
    };

    it('accepts a valid 4×4 color grid', () => {
      expect(SafetyCodeColorSchema.parse(validColor)).toMatchObject({
        type: 'color',
      });
    });

    it('rejects 15 cells (too few)', () => {
      expect(() =>
        SafetyCodeColorSchema.parse({
          ...validColor,
          cells: validColor.cells.slice(0, 15),
        })
      ).toThrow();
    });

    it('rejects a cell value of 16 (above max 15)', () => {
      expect(() =>
        SafetyCodeColorSchema.parse({
          ...validColor,
          cells: [16, ...validColor.cells.slice(1)],
        })
      ).toThrow();
    });

    it('rejects a cell value of -1 (below min 0)', () => {
      expect(() =>
        SafetyCodeColorSchema.parse({
          ...validColor,
          cells: [-1, ...validColor.cells.slice(1)],
        })
      ).toThrow();
    });
  });

  describe('SafetyCodeSchema (discriminatedUnion)', () => {
    it('selects emoji variant', () => {
      const result = SafetyCodeSchema.parse({
        type: 'emoji',
        emojis: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      });
      expect(result.type).toBe('emoji');
    });

    it('selects color variant', () => {
      const result = SafetyCodeSchema.parse({
        type: 'color',
        cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      });
      expect(result.type).toBe('color');
    });

    it('rejects unknown type', () => {
      expect(() => SafetyCodeSchema.parse({ type: 'identicon', data: 'x' })).toThrow();
    });
  });

  // ─── StoredCredential Schema ────────────────────────────────────────────────

  describe('StoredCredentialSchema', () => {
    const valid = {
      credentialId: b64,
      publicKey: b64,
      signCount: 42,
      aaguid: b64,
    };

    it('accepts a credential without transports', () => {
      expect(StoredCredentialSchema.parse(valid)).toMatchObject({
        signCount: 42,
      });
    });

    it('accepts a credential with transports', () => {
      const result = StoredCredentialSchema.parse({
        ...valid,
        transports: ['usb', 'nfc'],
      });
      expect(result.transports).toEqual(['usb', 'nfc']);
    });

    it('rejects negative signCount', () => {
      expect(() => StoredCredentialSchema.parse({ ...valid, signCount: -1 })).toThrow();
    });

    it('rejects unknown transport value', () => {
      expect(() => StoredCredentialSchema.parse({ ...valid, transports: ['bluetooth'] })).toThrow();
    });
  });

  // ─── Serialised WebAuthn Schemas ────────────────────────────────────────────

  describe('AttestationJSONSchema', () => {
    it('accepts a minimal attestation without transports', () => {
      expect(AttestationJSONSchema.parse(validAttestation)).toMatchObject({
        type: 'public-key',
      });
    });

    it('accepts attestation with transports array', () => {
      const result = AttestationJSONSchema.parse({
        ...validAttestation,
        response: { ...validAttestation.response, transports: ['usb'] },
      });
      expect(result.response.transports).toEqual(['usb']);
    });

    it('rejects wrong type field', () => {
      expect(() =>
        AttestationJSONSchema.parse({ ...validAttestation, type: 'public-key-2' })
      ).toThrow();
    });
  });

  describe('AssertionJSONSchema', () => {
    it('accepts assertion without userHandle', () => {
      expect(AssertionJSONSchema.parse(validAssertion)).toMatchObject({
        type: 'public-key',
      });
    });

    it('accepts assertion with userHandle as base64url string', () => {
      const result = AssertionJSONSchema.parse({
        ...validAssertion,
        response: { ...validAssertion.response, userHandle: b64 },
      });
      expect(result.response.userHandle).toBe(b64);
    });

    it('accepts assertion with userHandle as null', () => {
      const result = AssertionJSONSchema.parse({
        ...validAssertion,
        response: { ...validAssertion.response, userHandle: null },
      });
      expect(result.response.userHandle).toBeNull();
    });

    it('rejects userHandle with padding character', () => {
      expect(() =>
        AssertionJSONSchema.parse({
          ...validAssertion,
          response: { ...validAssertion.response, userHandle: 'abc=' },
        })
      ).toThrow();
    });
  });
});
