import { describe, expect, it } from 'vitest';

import {
  POLL_INTERVAL_MS,
  SECURITY_PROFILE,
  WS_CLOSE_CHANNEL_GONE,
  WS_CLOSE_INVALID_PAYLOAD,
  WS_CLOSE_NORMAL,
  WS_CLOSE_SUBSCRIBE_TIMEOUT,
  WS_PING_INTERVAL_MS,
  WS_RECONNECT_BASE_MS,
  WS_RECONNECT_MAX_MS,
  WS_SUBSCRIBE_TIMEOUT_MS,
} from '../constants.ts';

import {
  type WsClientMessage,
  WsClientMessageSchema,
  type WsServerMessage,
  WsServerMessageSchema,
} from '../ws.ts';

// ─── Server Messages ──────────────────────────────────────────────────────────

describe('WsServerMessageSchema', () => {
  it('parses state_changed with all fields', () => {
    const msg = {
      type: 'state_changed',
      state: 'locked',
      version: 3,
      adminMode: 'webauthn',
      securityProfile: SECURITY_PROFILE.SECURE,
      receiverPubFpr: 'ab01cd02',
    };
    const result = WsServerMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('state_changed');
    }
  });

  it('parses state_changed without optional receiverPubFpr', () => {
    const msg = {
      type: 'state_changed',
      state: 'waiting',
      version: 0,
      adminMode: 'password',
      securityProfile: SECURITY_PROFILE.QUICK,
    };
    const result = WsServerMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses channel_closed with reason deleted', () => {
    const msg = { type: 'channel_closed', reason: 'deleted' };
    const result = WsServerMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ type: 'channel_closed', reason: 'deleted' });
    }
  });

  it('parses channel_closed with reason expired', () => {
    const msg = { type: 'channel_closed', reason: 'expired' };
    const result = WsServerMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses pong', () => {
    const msg = { type: 'pong' };
    const result = WsServerMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('rejects unknown message type', () => {
    const msg = { type: 'unknown_type' };
    const result = WsServerMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('rejects state_changed with invalid state', () => {
    const msg = {
      type: 'state_changed',
      state: 'invalid_state',
      version: 1,
      adminMode: 'webauthn',
      securityProfile: SECURITY_PROFILE.SECURE,
    };
    const result = WsServerMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('rejects state_changed with negative version', () => {
    const msg = {
      type: 'state_changed',
      state: 'locked',
      version: -1,
      adminMode: 'webauthn',
      securityProfile: SECURITY_PROFILE.SECURE,
    };
    const result = WsServerMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('rejects channel_closed with invalid reason', () => {
    const msg = { type: 'channel_closed', reason: 'unknown' };
    const result = WsServerMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });
});

// ─── Client Messages ──────────────────────────────────────────────────────────

describe('WsClientMessageSchema', () => {
  it('parses subscribe with valid uuid', () => {
    const msg = { type: 'subscribe', uuid: 'abcdefghijklmnopqrstu' };
    const result = WsClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses ping', () => {
    const msg = { type: 'ping' };
    const result = WsClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('rejects subscribe with invalid uuid length', () => {
    const msg = { type: 'subscribe', uuid: 'tooshort' };
    const result = WsClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('rejects unknown client message type', () => {
    const msg = { type: 'disconnect' };
    const result = WsClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('WebSocket constants', () => {
  it('has correct close codes', () => {
    expect(WS_CLOSE_NORMAL).toBe(1000);
    expect(WS_CLOSE_CHANNEL_GONE).toBe(4000);
    expect(WS_CLOSE_INVALID_PAYLOAD).toBe(4001);
    expect(WS_CLOSE_SUBSCRIBE_TIMEOUT).toBe(4002);
  });

  it('has valid reconnect timing', () => {
    expect(WS_RECONNECT_BASE_MS).toBe(1_000);
    expect(WS_RECONNECT_MAX_MS).toBe(30_000);
    expect(WS_RECONNECT_MAX_MS).toBeGreaterThan(WS_RECONNECT_BASE_MS);
  });

  it('has ping interval shorter than typical idle timeout', () => {
    // Cloudflare DO WS idle timeout is ~60s; ping must be shorter
    expect(WS_PING_INTERVAL_MS).toBe(25_000);
    expect(WS_PING_INTERVAL_MS).toBeLessThan(60_000);
  });

  it('has subscribe timeout', () => {
    expect(WS_SUBSCRIBE_TIMEOUT_MS).toBe(5_000);
  });

  it('has poll interval in 15-20s range', () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThanOrEqual(15_000);
    expect(POLL_INTERVAL_MS).toBeLessThanOrEqual(20_000);
  });
});

// ─── Type-level assertions ────────────────────────────────────────────────────

describe('type compatibility', () => {
  it('WsServerMessage is assignable from parsed output', () => {
    const msg = {
      type: 'state_changed' as const,
      state: 'locked' as const,
      version: 1,
      adminMode: 'webauthn' as const,
      securityProfile: SECURITY_PROFILE.SECURE,
    };
    const parsed = WsServerMessageSchema.parse(msg);
    const _check: WsServerMessage = parsed;
    expect(_check).toBeDefined();
  });

  it('WsClientMessage is assignable from parsed output', () => {
    const msg = { type: 'ping' as const };
    const parsed = WsClientMessageSchema.parse(msg);
    const _check: WsClientMessage = parsed;
    expect(_check).toBeDefined();
  });
});
