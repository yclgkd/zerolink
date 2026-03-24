import { describe, expect, it } from 'vitest';

import {
  CompoundChallengeSchema,
  CreateBeginRequestSchema,
  CreateBeginResponseSchema,
  CreateFinishRequestSchema,
  CreateFinishResponseSchema,
  LockBeginRequestSchema,
  LockBeginResponseSchema,
  LockChallengeSchema,
  LockCommitRequestSchema,
  ReceiverIdentitySchema,
} from '../schemas.ts';

import {
  b64,
  hex,
  uuid21,
  validAttestation,
  validEcdsaJwk,
  validJwk,
} from './helpers/schema-fixtures.ts';

describe('schemas - channel', () => {
  // ─── Challenge Schemas ──────────────────────────────────────────────────────

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

  // ─── ReceiverIdentity Schema ────────────────────────────────────────────────

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

  // ─── Create Flow Schemas ────────────────────────────────────────────────────

  describe('CreateBeginRequestSchema', () => {
    it('accepts valid create-begin request', () => {
      const result = CreateBeginRequestSchema.parse({
        uuid: uuid21(),
        timestamp: 1_730_000_000_000,
        securityProfile: 'quick',
      });
      expect(result.securityProfile).toBe('quick');
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
          securityProfile: 'quick',
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

  // ─── Lock Flow Schemas ──────────────────────────────────────────────────────

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
});
