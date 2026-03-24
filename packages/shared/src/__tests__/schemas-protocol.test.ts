import { describe, expect, it } from 'vitest';

import {
  CompoundBeginRequestSchema,
  CompoundBeginResponseSchema,
  CompoundCommitRequestSchema,
  CompoundCommitResponseSchema,
  DecryptFetchResponseSchema,
  DeleteIntentSchema,
  ErrorResponseSchema,
  ManageIntentSchema,
  PublicStatusResponseSchema,
  SoftkeyCompoundCommitRequestSchema,
  UpdateIntentSchema,
} from '../schemas.ts';

import {
  b64,
  hex,
  uuid21,
  validAssertion,
  validCipherBundle,
  validJwk,
} from './helpers/schema-fixtures.ts';

describe('schemas - protocol', () => {
  // ─── CompoundBegin Schemas ──────────────────────────────────────────────────

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
        securityProfile: 'secure',
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

  // ─── Intent Schemas ─────────────────────────────────────────────────────────

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

  // ─── CompoundCommit Schemas ─────────────────────────────────────────────────

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

  // ─── Softkey Schema ─────────────────────────────────────────────────────────

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

  // ─── DecryptFetch Schema ────────────────────────────────────────────────────

  describe('DecryptFetchResponseSchema', () => {
    it('accepts decrypt payloads with cipherVersion', () => {
      const result = DecryptFetchResponseSchema.parse({
        ok: true,
        cipherBundle: validCipherBundle,
        receiverPubFpr: hex,
        cipherVersion: 3,
        deliveredAt: 1_730_000_000_000,
      });

      expect(result.cipherVersion).toBe(3);
    });

    it('accepts decrypt payloads with deliveryAuth', () => {
      const result = DecryptFetchResponseSchema.parse({
        ok: true,
        cipherBundle: validCipherBundle,
        receiverPubFpr: hex,
        cipherVersion: 3,
        deliveredAt: 1_730_000_000_000,
        deliveryAuth: {
          adminMode: 'password',
          meta: {
            version: 3,
            timestamp: 1_730_000_000_000,
            nonce: b64,
            expireAt: null,
          },
          signer: {
            softkeyPubJwk: {
              kty: 'EC',
              crv: 'P-256',
              x: b64,
              y: b64,
              ext: true,
              key_ops: ['verify'],
            },
          },
          proof: {
            softkeySignature: `${hex}${hex}`,
          },
        },
      });

      expect(result.deliveryAuth?.meta.version).toBe(3);
    });

    it('rejects negative cipherVersion', () => {
      expect(() =>
        DecryptFetchResponseSchema.parse({
          ok: true,
          cipherBundle: validCipherBundle,
          receiverPubFpr: hex,
          cipherVersion: -1,
          deliveredAt: 1_730_000_000_000,
        })
      ).toThrow();
    });
  });

  // ─── Status & Error Schemas ─────────────────────────────────────────────────

  describe('PublicStatusResponseSchema', () => {
    it.each([
      'waiting',
      'locked',
      'delivered',
      'deleted',
      'expired',
    ])('accepts state %s', (state) => {
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
});
