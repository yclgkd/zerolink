import {
  type Base64Url,
  CHANNEL_STATE,
  CHANNEL_TTL_MS,
  type ChannelRecord,
  type HexString,
  SECURITY_PROFILE,
  type UnixMs,
  type UUID,
  WS_CLOSE_CHANNEL_GONE,
} from '@zerolink/shared';
import { describe, expect, it, vi } from 'vitest';

import { handleWebSocketMessage } from '../SecretVaultWebSocket.ts';

function asUuid(value: string): UUID {
  return value as UUID;
}

function asBase64Url(value: string): Base64Url {
  return value as Base64Url;
}

function asHexString(value: string): HexString {
  return value as HexString;
}

function asUnixMs(value: number): UnixMs {
  return value as UnixMs;
}

function createRecord(): ChannelRecord {
  return {
    uuid: asUuid('abcdefghijklmnopqrstu'),
    state: CHANNEL_STATE.LOCKED,
    createdAt: asUnixMs(1_730_000_000_000),
    expiresAt: asUnixMs(1_730_000_000_000 + CHANNEL_TTL_MS.ONE_DAY),
    ttl: CHANNEL_TTL_MS.ONE_DAY,
    securityProfile: SECURITY_PROFILE.QUICK,
    adminMode: 'webauthn',
    adminCredential: {
      credentialId: asBase64Url('credential-id'),
      publicKey: asBase64Url('public-key'),
      signCount: 1,
      aaguid: asBase64Url('aaguid'),
    },
    lockKey: asBase64Url('lock-key'),
    receiver: {
      pubJwk: {
        kty: 'RSA',
        alg: 'RSA-OAEP-256',
        n: asBase64Url('modulus'),
        e: asBase64Url('AQAB'),
        ext: true,
        key_ops: ['encrypt'],
      },
      pubFpr: asHexString('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'),
      lockedAt: asUnixMs(1_730_000_100_000),
    },
    version: 3,
  };
}

function createMockSocket() {
  return {
    send: vi.fn<(payload: string) => void>(),
    close: vi.fn<(code?: number, reason?: string) => void>(),
  };
}

describe('handleWebSocketMessage', () => {
  it('sends a state snapshot when subscribe targets an active record', () => {
    const socket = createMockSocket();

    handleWebSocketMessage(
      socket as unknown as WebSocket,
      JSON.stringify({ type: 'subscribe', uuid: 'abcdefghijklmnopqrstu' }),
      createRecord()
    );

    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0]?.[0] ?? '')).toEqual({
      type: 'state_changed',
      state: 'locked',
      version: 3,
      adminMode: 'webauthn',
      securityProfile: SECURITY_PROFILE.QUICK,
      receiverPubFpr: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    });
  });

  it('closes the socket when subscribe targets a missing record', () => {
    const socket = createMockSocket();

    handleWebSocketMessage(
      socket as unknown as WebSocket,
      JSON.stringify({ type: 'subscribe', uuid: 'abcdefghijklmnopqrstu' }),
      undefined
    );

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(WS_CLOSE_CHANNEL_GONE, 'channel gone');
  });
});
