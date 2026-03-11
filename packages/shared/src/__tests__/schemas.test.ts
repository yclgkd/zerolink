import { describe, expect, it } from 'vitest';

import {
  AdminModeSchema,
  Argon2idParamsSchema,
  AssertionJSONSchema,
  AttestationJSONSchema,
  Base64UrlSchema,
  ChannelStateSchema,
  ChannelTtlMsSchema,
  CipherBundleSchema,
  CompoundBeginRequestSchema,
  CompoundBeginResponseSchema,
  CompoundChallengeSchema,
  CompoundCommitRequestSchema,
  CompoundCommitResponseSchema,
  CreateBeginRequestSchema,
  CreateBeginResponseSchema,
  CreateFinishRequestSchema,
  CreateFinishResponseSchema,
  DeleteIntentSchema,
  ECDSAPublicKeyJWKSchema,
  ErrorResponseSchema,
  HexStringSchema,
  KdfParamsSchema,
  LockBeginRequestSchema,
  LockBeginResponseSchema,
  LockChallengeSchema,
  LockCommitRequestSchema,
  ManageIntentSchema,
  Pbkdf2ParamsSchema,
  PublicStatusResponseSchema,
  ReceiverIdentitySchema,
  RSAPublicKeyJWKSchema,
  SafetyCodeColorSchema,
  SafetyCodeEmojiSchema,
  SafetyCodeSchema,
  SecurityProfileSchema,
  SoftkeyCompoundCommitRequestSchema,
  StoredCredentialSchema,
  UnixMsSchema,
  UpdateIntentSchema,
  UUIDSchema,
  WrappedPrivateKeySchema,
} from '../schemas.ts';
import type { Base64Url, HexString, UnixMs, UUID } from '../types.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generates a 21-character string of a single repeating character. */
const uuid21 = (c = 'a') => c.repeat(21);

/** Minimal valid base64url string. */
const b64 = 'abc123_-ABC';

/** Minimal valid lowercase hex string. */
const hex = 'deadbeef';

/** Minimal valid RSA-OAEP JWK. */
const validJwk = {
  kty: 'RSA' as const,
  alg: 'RSA-OAEP-256' as const,
  n: b64,
  e: b64,
  ext: true as const,
  key_ops: ['encrypt'] as const,
};

/** Minimal valid ECDSA P-256 JWK. */
const validEcdsaJwk = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: b64,
  y: b64,
  ext: true as const,
  key_ops: ['verify'] as const,
};

/** Minimal valid CipherBundle. */
const validCipherBundle = {
  ciphertext: b64,
  iv: b64,
  aad: b64,
  encContentKey: b64,
  ciphertextHash: hex,
  padBlock: 4096,
};

/** Minimal valid AttestationJSON. */
const validAttestation = {
  id: b64,
  rawId: b64,
  type: 'public-key' as const,
  response: {
    clientDataJSON: b64,
    attestationObject: b64,
  },
};

/** Minimal valid AssertionJSON. */
const validAssertion = {
  id: b64,
  rawId: b64,
  type: 'public-key' as const,
  response: {
    clientDataJSON: b64,
    authenticatorData: b64,
    signature: b64,
  },
};

// ─── Primitive Schemas ────────────────────────────────────────────────────────

describe('UUIDSchema', () => {
  it('accepts a 21-character string and returns UUID brand', () => {
    const result = UUIDSchema.parse(uuid21());
    expect(result).toHaveLength(21);
    // Type-level: result is assignable to UUID
    const _: UUID = result;
    expect(_).toBeDefined();
  });

  it('rejects a 20-character string', () => {
    expect(() => UUIDSchema.parse('a'.repeat(20))).toThrow();
  });

  it('rejects a 22-character string', () => {
    expect(() => UUIDSchema.parse('a'.repeat(22))).toThrow();
  });

  it('rejects a non-string value', () => {
    expect(() => UUIDSchema.parse(12345)).toThrow();
  });
});

describe('Base64UrlSchema', () => {
  it('accepts a valid base64url string', () => {
    const result = Base64UrlSchema.parse('abc123_-ABC');
    const _: Base64Url = result;
    expect(_).toBe('abc123_-ABC');
  });

  it('rejects a string with padding (=)', () => {
    expect(() => Base64UrlSchema.parse('abc=')).toThrow();
  });

  it('rejects standard base64 with + or /', () => {
    expect(() => Base64UrlSchema.parse('a+b')).toThrow();
    expect(() => Base64UrlSchema.parse('a/b')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => Base64UrlSchema.parse('')).toThrow();
  });
});

describe('HexStringSchema', () => {
  it('accepts a valid lowercase hex string', () => {
    const result = HexStringSchema.parse('deadbeef0123456789abcdef');
    const _: HexString = result;
    expect(_).toBe('deadbeef0123456789abcdef');
  });

  it('rejects uppercase hex', () => {
    expect(() => HexStringSchema.parse('DEADBEEF')).toThrow();
  });

  it('rejects non-hex characters', () => {
    expect(() => HexStringSchema.parse('xyz')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => HexStringSchema.parse('')).toThrow();
  });
});

describe('UnixMsSchema', () => {
  it('accepts a valid positive integer timestamp', () => {
    const result = UnixMsSchema.parse(1_730_000_000_000);
    const _: UnixMs = result;
    expect(_).toBe(1_730_000_000_000);
  });

  it('accepts zero (epoch)', () => {
    expect(UnixMsSchema.parse(0)).toBe(0);
  });

  it('rejects a negative value', () => {
    expect(() => UnixMsSchema.parse(-1)).toThrow();
  });

  it('rejects a non-integer (float)', () => {
    expect(() => UnixMsSchema.parse(1.5)).toThrow();
  });
});

// ─── Enum Schemas ─────────────────────────────────────────────────────────────

describe('ChannelStateSchema', () => {
  it.each(['waiting', 'locked', 'delivered', 'deleted', 'expired'])('accepts state %s', (state) => {
    expect(ChannelStateSchema.parse(state)).toBe(state);
  });

  it('rejects an unknown state', () => {
    expect(() => ChannelStateSchema.parse('active')).toThrow();
  });
});

describe('SecurityProfileSchema', () => {
  it.each(['quick', 'secure'])('accepts new profile %s', (profile) => {
    expect(SecurityProfileSchema.parse(profile)).toBe(profile);
  });

  it.each(['standard', 'strict', 'hardware_only'])('accepts legacy profile %s', (profile) => {
    expect(SecurityProfileSchema.parse(profile)).toBe(profile);
  });

  it('rejects unknown profile', () => {
    expect(() => SecurityProfileSchema.parse('ultra')).toThrow();
  });
});

describe('ChannelTtlMsSchema', () => {
  it.each([3_600_000, 86_400_000, 604_800_000])('accepts TTL %d', (ttl) => {
    expect(ChannelTtlMsSchema.parse(ttl)).toBe(ttl);
  });

  it('rejects an arbitrary number', () => {
    expect(() => ChannelTtlMsSchema.parse(9_999_999)).toThrow();
  });
});

describe('AdminModeSchema', () => {
  it('accepts webauthn', () => {
    expect(AdminModeSchema.parse('webauthn')).toBe('webauthn');
  });

  it('accepts password', () => {
    expect(AdminModeSchema.parse('password')).toBe('password');
  });

  it('accepts softkey (legacy)', () => {
    expect(AdminModeSchema.parse('softkey')).toBe('softkey');
  });

  it('rejects unknown mode', () => {
    expect(() => AdminModeSchema.parse('biometric')).toThrow();
  });
});

// ─── RSAPublicKeyJWK Schema ───────────────────────────────────────────────────

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

// ─── KDF Parameter Schemas ────────────────────────────────────────────────────

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

// ─── WrappedPrivateKey Schema ─────────────────────────────────────────────────

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

// ─── CipherBundle Schema ──────────────────────────────────────────────────────

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

// ─── Safety Code Schemas ──────────────────────────────────────────────────────

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

// ─── StoredCredential Schema ──────────────────────────────────────────────────

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

// ─── Challenge Schemas ────────────────────────────────────────────────────────

describe('LockChallengeSchema', () => {
  const valid = { id: b64, challenge: b64, expiresAt: 1_730_000_000_000 };

  it('accepts a valid lock challenge', () => {
    expect(LockChallengeSchema.parse(valid)).toMatchObject({ id: b64 });
  });

  it('rejects missing challenge field', () => {
    const { challenge: _, ...rest } = valid;
    expect(() => LockChallengeSchema.parse(rest)).toThrow();
  });
});

describe('CompoundChallengeSchema', () => {
  const valid = { id: b64, seed: b64, expiresAt: 1_730_000_000_000 };

  it('accepts a valid compound challenge', () => {
    expect(CompoundChallengeSchema.parse(valid)).toMatchObject({ seed: b64 });
  });

  it('rejects missing seed', () => {
    const { seed: _, ...rest } = valid;
    expect(() => CompoundChallengeSchema.parse(rest)).toThrow();
  });
});

// ─── Serialised WebAuthn Schemas ──────────────────────────────────────────────

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

// ─── ReceiverIdentity Schema ──────────────────────────────────────────────────

describe('ReceiverIdentitySchema', () => {
  it('accepts valid receiver identity', () => {
    const result = ReceiverIdentitySchema.parse({
      pubJwk: validJwk,
      pubFpr: hex,
      lockedAt: 1_730_000_000_000,
    });
    expect(result.pubFpr).toBe(hex);
  });

  it('rejects uppercase pubFpr', () => {
    expect(() =>
      ReceiverIdentitySchema.parse({
        pubJwk: validJwk,
        pubFpr: 'DEADBEEF',
        lockedAt: 1000,
      })
    ).toThrow();
  });
});

// ─── API Request / Response Schemas ──────────────────────────────────────────

describe('CreateBeginRequestSchema', () => {
  it('accepts valid create-begin request', () => {
    const result = CreateBeginRequestSchema.parse({
      uuid: uuid21(),
      timestamp: 1_730_000_000_000,
      securityProfile: 'standard',
    });
    expect(result.securityProfile).toBe('standard');
  });

  it('rejects unknown securityProfile', () => {
    expect(() =>
      CreateBeginRequestSchema.parse({
        uuid: uuid21(),
        timestamp: 1000,
        securityProfile: 'ultra',
      })
    ).toThrow();
  });

  it('rejects uuid of wrong length', () => {
    expect(() =>
      CreateBeginRequestSchema.parse({
        uuid: 'short',
        timestamp: 1000,
        securityProfile: 'standard',
      })
    ).toThrow();
  });
});

describe('CreateBeginResponseSchema', () => {
  it('accepts a valid response with opaque creationOptions', () => {
    const result = CreateBeginResponseSchema.parse({
      ok: true,
      creationOptions: { challenge: b64, rp: { name: 'ZeroLink' } },
    });
    expect(result.ok).toBe(true);
  });
});

describe('CreateFinishResponseSchema', () => {
  it('accepts a valid create-finish response', () => {
    const result = CreateFinishResponseSchema.parse({
      ok: true,
      shareUrl: '/s/abc123',
      manageUrl: '/m/abc123',
    });
    expect(result.ok).toBe(true);
    expect(result.shareUrl).toBe('/s/abc123');
  });

  it('rejects empty shareUrl', () => {
    expect(() =>
      CreateFinishResponseSchema.parse({
        ok: true,
        shareUrl: '',
        manageUrl: '/m/abc',
      })
    ).toThrow();
  });

  it('rejects empty manageUrl', () => {
    expect(() =>
      CreateFinishResponseSchema.parse({
        ok: true,
        shareUrl: '/s/abc',
        manageUrl: '',
      })
    ).toThrow();
  });
});

describe('CreateFinishRequestSchema', () => {
  it('accepts a valid webauthn create-finish request', () => {
    const result = CreateFinishRequestSchema.parse({
      adminMode: 'webauthn',
      uuid: uuid21(),
      attestation: validAttestation,
      lockKeyB64u: b64,
      timestamp: 1_730_000_000_000,
    });
    expect(result.lockKeyB64u).toBe(b64);
  });

  it('accepts a valid password create-finish request', () => {
    const result = CreateFinishRequestSchema.parse({
      adminMode: 'password',
      uuid: uuid21(),
      softkeyPubJwk: validEcdsaJwk,
      lockKeyB64u: b64,
      timestamp: 1_730_000_000_000,
    });
    expect(result.lockKeyB64u).toBe(b64);
  });

  it('accepts a valid softkey create-finish request (legacy)', () => {
    const result = CreateFinishRequestSchema.parse({
      adminMode: 'softkey',
      uuid: uuid21(),
      softkeyPubJwk: validEcdsaJwk,
      lockKeyB64u: b64,
      timestamp: 1_730_000_000_000,
    });
    expect(result.lockKeyB64u).toBe(b64);
  });

  it('rejects request missing adminMode', () => {
    expect(() =>
      CreateFinishRequestSchema.parse({
        uuid: uuid21(),
        attestation: validAttestation,
        lockKeyB64u: b64,
        timestamp: 1000,
      })
    ).toThrow();
  });

  it('rejects lockKeyB64u with padding (webauthn variant)', () => {
    expect(() =>
      CreateFinishRequestSchema.parse({
        adminMode: 'webauthn',
        uuid: uuid21(),
        attestation: validAttestation,
        lockKeyB64u: 'abc=',
        timestamp: 1000,
      })
    ).toThrow();
  });
});

describe('LockBeginRequestSchema', () => {
  it('accepts a valid uuid', () => {
    expect(LockBeginRequestSchema.parse({ uuid: uuid21() })).toMatchObject({});
  });
});

describe('LockBeginResponseSchema', () => {
  it('accepts a valid lock-begin response', () => {
    const result = LockBeginResponseSchema.parse({
      ok: true,
      lockChallenge: { id: b64, challenge: b64, expiresAt: 1_730_000_000_000 },
    });
    expect(result.ok).toBe(true);
  });
});

describe('LockCommitRequestSchema', () => {
  const valid = {
    uuid: uuid21(),
    lockChallengeId: b64,
    lockProof: hex,
    receiverPubJwk: validJwk,
    receiverPubFpr: hex,
    lockedAt: 1_730_000_000_000,
  };

  it('accepts a valid lock-commit request', () => {
    expect(LockCommitRequestSchema.parse(valid)).toMatchObject({
      lockProof: hex,
    });
  });

  it('rejects uppercase lockProof', () => {
    expect(() => LockCommitRequestSchema.parse({ ...valid, lockProof: 'DEADBEEF' })).toThrow();
  });

  it('rejects missing receiverPubJwk', () => {
    const { receiverPubJwk: _, ...rest } = valid;
    expect(() => LockCommitRequestSchema.parse(rest)).toThrow();
  });
});

describe('CompoundBeginRequestSchema', () => {
  it('accepts a valid uuid', () => {
    expect(CompoundBeginRequestSchema.parse({ uuid: uuid21() })).toMatchObject({});
  });
});

describe('CompoundBeginResponseSchema', () => {
  it('accepts response without optional fields', () => {
    const result = CompoundBeginResponseSchema.parse({
      ok: true,
      challenge: { id: b64, seed: b64, expiresAt: 1_730_000_000_000 },
      currentVersion: 0,
      securityProfile: 'secure',
      adminMode: 'webauthn',
    });
    expect(result.currentVersion).toBe(0);
    expect(result.receiverPubFpr).toBeUndefined();
  });

  it('accepts response with allowCredentials', () => {
    const result = CompoundBeginResponseSchema.parse({
      ok: true,
      challenge: { id: b64, seed: b64, expiresAt: 1_730_000_000_000 },
      allowCredentials: [{ id: b64, type: 'public-key' }],
      currentVersion: 0,
      securityProfile: 'secure',
      adminMode: 'webauthn',
    });
    expect(result.allowCredentials).toEqual([{ id: b64, type: 'public-key' }]);
  });

  it('accepts response with optional receiverPubFpr and receiverPubJwk', () => {
    const result = CompoundBeginResponseSchema.parse({
      ok: true,
      challenge: { id: b64, seed: b64, expiresAt: 1_730_000_000_000 },
      currentVersion: 1,
      receiverPubFpr: hex,
      receiverPubJwk: validJwk,
      securityProfile: 'standard',
      adminMode: 'webauthn',
    });
    expect(result.receiverPubFpr).toBe(hex);
  });

  it('accepts response with adminMode password', () => {
    const result = CompoundBeginResponseSchema.parse({
      ok: true,
      challenge: { id: b64, seed: b64, expiresAt: 1_730_000_000_000 },
      currentVersion: 2,
      securityProfile: 'quick',
      adminMode: 'password',
    });
    expect(result.adminMode).toBe('password');
  });

  it('accepts response with adminMode softkey (legacy)', () => {
    const result = CompoundBeginResponseSchema.parse({
      ok: true,
      challenge: { id: b64, seed: b64, expiresAt: 1_730_000_000_000 },
      currentVersion: 2,
      securityProfile: 'quick',
      adminMode: 'softkey',
    });
    expect(result.adminMode).toBe('softkey');
  });

  it('rejects unknown adminMode', () => {
    expect(() =>
      CompoundBeginResponseSchema.parse({
        ok: true,
        challenge: { id: b64, seed: b64, expiresAt: 1_730_000_000_000 },
        currentVersion: 0,
        securityProfile: 'secure',
        adminMode: 'unknown',
      })
    ).toThrow();
  });

  it('rejects missing securityProfile', () => {
    expect(() =>
      CompoundBeginResponseSchema.parse({
        ok: true,
        challenge: { id: b64, seed: b64, expiresAt: 1_730_000_000_000 },
        currentVersion: 0,
        adminMode: 'webauthn',
      })
    ).toThrow();
  });
});

// ─── Intent Schemas ───────────────────────────────────────────────────────────

describe('UpdateIntentSchema', () => {
  const valid = {
    op: 'update' as const,
    uuid: uuid21(),
    version: 1,
    timestamp: 1_730_000_000_000,
    nonce: b64,
    receiverPubFpr: hex,
    cipherBundle: validCipherBundle,
    expireAt: null,
  };

  it('accepts an update intent with expireAt null', () => {
    expect(UpdateIntentSchema.parse(valid)).toMatchObject({ op: 'update' });
  });

  it('accepts an update intent with expireAt as a timestamp', () => {
    const result = UpdateIntentSchema.parse({
      ...valid,
      expireAt: 1_740_000_000_000,
    });
    expect(result.expireAt).toBe(1_740_000_000_000);
  });

  it('rejects missing cipherBundle', () => {
    const { cipherBundle: _, ...rest } = valid;
    expect(() => UpdateIntentSchema.parse(rest)).toThrow();
  });
});

describe('DeleteIntentSchema', () => {
  const valid = {
    op: 'delete' as const,
    uuid: uuid21(),
    version: 2,
    timestamp: 1_730_000_000_000,
    nonce: b64,
  };

  it('accepts a delete intent', () => {
    expect(DeleteIntentSchema.parse(valid)).toMatchObject({ op: 'delete' });
  });

  it('rejects missing nonce', () => {
    const { nonce: _, ...rest } = valid;
    expect(() => DeleteIntentSchema.parse(rest)).toThrow();
  });
});

describe('ManageIntentSchema (discriminatedUnion)', () => {
  it('routes to update variant', () => {
    const result = ManageIntentSchema.parse({
      op: 'update',
      uuid: uuid21(),
      version: 0,
      timestamp: 1_730_000_000_000,
      nonce: b64,
      receiverPubFpr: hex,
      cipherBundle: validCipherBundle,
      expireAt: null,
    });
    expect(result.op).toBe('update');
  });

  it('routes to delete variant', () => {
    const result = ManageIntentSchema.parse({
      op: 'delete',
      uuid: uuid21(),
      version: 0,
      timestamp: 1_730_000_000_000,
      nonce: b64,
    });
    expect(result.op).toBe('delete');
  });

  it('rejects unknown op', () => {
    expect(() => ManageIntentSchema.parse({ op: 'purge', uuid: uuid21(), version: 0 })).toThrow();
  });

  it('rejects update intent missing cipherBundle', () => {
    expect(() =>
      ManageIntentSchema.parse({
        op: 'update',
        uuid: uuid21(),
        version: 0,
        timestamp: 1000,
        nonce: b64,
        receiverPubFpr: hex,
        expireAt: null,
      })
    ).toThrow();
  });
});

describe('CompoundCommitRequestSchema', () => {
  it('accepts a valid compound-commit request', () => {
    const result = CompoundCommitRequestSchema.parse({
      uuid: uuid21(),
      assertion: validAssertion,
      intentHash: hex,
      intent: {
        op: 'delete',
        uuid: uuid21(),
        version: 1,
        timestamp: 1_730_000_000_000,
        nonce: b64,
      },
    });
    expect(result.intentHash).toBe(hex);
  });
});

describe('CompoundCommitResponseSchema', () => {
  it('accepts { ok: true }', () => {
    expect(CompoundCommitResponseSchema.parse({ ok: true })).toEqual({
      ok: true,
    });
  });
});

// ─── Status & Error Schemas ───────────────────────────────────────────────────

describe('PublicStatusResponseSchema', () => {
  it.each(['waiting', 'locked', 'delivered', 'deleted', 'expired'])('accepts state %s', (state) => {
    const result = PublicStatusResponseSchema.parse({
      ok: true,
      state,
      adminMode: 'webauthn',
      securityProfile: 'secure',
    });
    expect(result.state).toBe(state);
  });

  it('rejects unknown state', () => {
    expect(() =>
      PublicStatusResponseSchema.parse({
        ok: true,
        state: 'open',
        adminMode: 'webauthn',
        securityProfile: 'secure',
      })
    ).toThrow();
  });

  it('rejects missing securityProfile', () => {
    expect(() =>
      PublicStatusResponseSchema.parse({ ok: true, state: 'waiting', adminMode: 'webauthn' })
    ).toThrow();
  });
});

describe('ErrorResponseSchema', () => {
  it('accepts a valid error response', () => {
    const result = ErrorResponseSchema.parse({
      ok: false,
      code: 'CHANNEL_NOT_FOUND',
    });
    expect(result.code).toBe('CHANNEL_NOT_FOUND');
  });

  it('rejects empty code string', () => {
    expect(() => ErrorResponseSchema.parse({ ok: false, code: '' })).toThrow();
  });

  it('rejects ok:true', () => {
    expect(() => ErrorResponseSchema.parse({ ok: true, code: 'X' })).toThrow();
  });
});

// ─── ECDSAPublicKeyJWK Schema ─────────────────────────────────────────────────

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
    expect(() => ECDSAPublicKeyJWKSchema.parse({ ...validEcdsaJwk, key_ops: ['sign'] })).toThrow();
  });

  it('rejects x with padding character', () => {
    expect(() => ECDSAPublicKeyJWKSchema.parse({ ...validEcdsaJwk, x: 'abc=' })).toThrow();
  });
});

// ─── SoftkeyCompoundCommitRequest Schema ─────────────────────────────────────

describe('SoftkeyCompoundCommitRequestSchema', () => {
  const validDeleteIntent = {
    op: 'delete' as const,
    uuid: uuid21(),
    version: 1,
    timestamp: 1_730_000_000_000,
    nonce: b64,
  };

  it('accepts a valid password compound-commit request', () => {
    const result = SoftkeyCompoundCommitRequestSchema.parse({
      adminMode: 'password',
      uuid: uuid21(),
      softkeySignature: hex,
      intentHash: hex,
      intent: validDeleteIntent,
    });
    expect(result.adminMode).toBe('password');
    expect(result.softkeySignature).toBe(hex);
  });

  it('accepts legacy softkey adminMode', () => {
    const result = SoftkeyCompoundCommitRequestSchema.parse({
      adminMode: 'softkey',
      uuid: uuid21(),
      softkeySignature: hex,
      intentHash: hex,
      intent: validDeleteIntent,
    });
    expect(result.adminMode).toBe('softkey');
  });

  it('rejects wrong adminMode', () => {
    expect(() =>
      SoftkeyCompoundCommitRequestSchema.parse({
        adminMode: 'webauthn',
        uuid: uuid21(),
        softkeySignature: hex,
        intentHash: hex,
        intent: validDeleteIntent,
      })
    ).toThrow();
  });

  it('rejects uppercase softkeySignature', () => {
    expect(() =>
      SoftkeyCompoundCommitRequestSchema.parse({
        adminMode: 'password',
        uuid: uuid21(),
        softkeySignature: 'DEADBEEF',
        intentHash: hex,
        intent: validDeleteIntent,
      })
    ).toThrow();
  });

  it('rejects missing intent', () => {
    expect(() =>
      SoftkeyCompoundCommitRequestSchema.parse({
        adminMode: 'password',
        uuid: uuid21(),
        softkeySignature: hex,
        intentHash: hex,
      })
    ).toThrow();
  });
});
