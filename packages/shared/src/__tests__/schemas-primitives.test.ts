import { describe, expect, it } from 'vitest';

import {
  AdminModeSchema,
  Base64UrlSchema,
  ChannelStateSchema,
  ChannelTtlMsSchema,
  HexStringSchema,
  SecurityProfileSchema,
  UnixMsSchema,
  UUIDSchema,
} from '../schemas.ts';
import type { Base64Url, HexString, UnixMs, UUID } from '../types.ts';

import { uuid21 } from './helpers/schema-fixtures.ts';

describe('schemas - primitives', () => {
  // ─── UUID ──────────────────────────────────────────────────────────────────

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

  // ─── Enum Schemas ──────────────────────────────────────────────────────────

  describe('ChannelStateSchema', () => {
    it.each([
      'waiting',
      'locked',
      'delivered',
      'deleted',
      'expired',
    ])('accepts state %s', (state) => {
      expect(ChannelStateSchema.parse(state)).toBe(state);
    });

    it('rejects an unknown state', () => {
      expect(() => ChannelStateSchema.parse('active')).toThrow();
    });
  });

  describe('SecurityProfileSchema', () => {
    it.each(['quick', 'secure'])('accepts profile %s', (profile) => {
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
});
