import {
  HexStringSchema,
  LockBeginResponseSchema,
  LockCommitResponseSchema,
  RSAPublicKeyJWKSchema,
  type SafetyCodeDisplay,
  UnixMsSchema,
  UUIDSchema,
} from '@zerolink/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { useLockStore } from '../stores/lock-store';

const VALID_UUID = UUIDSchema.parse('aaaaaaaaaaaaaaaaaaaaa');
const VALID_HEX = HexStringSchema.parse(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

function buildLockBeginResponse() {
  return LockBeginResponseSchema.parse({
    ok: true,
    lockChallenge: {
      id: 'bW9ja19jaGFsbGVuZ2VfaWQ',
      challenge: 'bW9ja19jaGFsbGVuZ2U',
      expiresAt: 1_700_000_000_000,
    },
  });
}

function buildLockCommitResponse() {
  return LockCommitResponseSchema.parse({
    ok: true,
  });
}

function buildReceiverPubJwk() {
  return RSAPublicKeyJWKSchema.parse({
    kty: 'RSA',
    alg: 'RSA-OAEP-256',
    n: 'bW9ja19tb2R1bHVz',
    e: 'AQAB',
    ext: true,
    key_ops: ['encrypt'],
  });
}

function buildSafetyCodeDisplay(): SafetyCodeDisplay {
  return {
    emoji: {
      type: 'emoji',
      emojis: ['🔥', '🌲', '🚀', '🔮', '💎', '🎯', '⚡', '🌙'],
    },
    color: {
      type: 'color',
      cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    },
    shortFpr: 'a1b2c3...d4e5f6',
    fullFpr: VALID_HEX,
  };
}

beforeEach(() => {
  useLockStore.getState().resetLockStore();
});

describe('useLockStore', () => {
  it('uses expected defaults', () => {
    const state = useLockStore.getState();

    expect(state.uuid).toBeNull();
    expect(state.step).toBe('onboarding');
    expect(state.passphrase).toBe('');
    expect(state.lockChallenge).toBeNull();
    expect(state.receiverPubJwk).toBeNull();
    expect(state.receiverPubFpr).toBeNull();
    expect(state.lockedAt).toBeNull();
    expect(state.safetyCode).toBeNull();
    expect(state.lockBegin).toEqual({ status: 'idle', data: null, errorCode: null });
    expect(state.lockCommit).toEqual({ status: 'idle', data: null, errorCode: null });
  });

  it('handles passphrase and step updates including markLocked', () => {
    const state = useLockStore.getState();

    state.setLockUuid(VALID_UUID);
    state.setStep('lock');
    state.setPassphrase('Strong#Pass1234');

    let nextState = useLockStore.getState();
    expect(nextState.uuid).toBe(VALID_UUID);
    expect(nextState.step).toBe('lock');
    expect(nextState.passphrase).toBe('Strong#Pass1234');

    state.clearPassphrase();
    expect(useLockStore.getState().passphrase).toBe('');

    state.setPassphrase('AnotherPass');
    state.markLocked();

    nextState = useLockStore.getState();
    expect(nextState.step).toBe('locked');
    expect(nextState.passphrase).toBe('');
  });

  it('tracks lock_begin lifecycle and stores challenge', () => {
    const state = useLockStore.getState();

    state.startLockBegin();
    expect(useLockStore.getState().lockBegin).toEqual({
      status: 'loading',
      data: null,
      errorCode: null,
    });

    const beginPayload = buildLockBeginResponse();
    state.completeLockBegin(beginPayload);

    expect(useLockStore.getState().lockBegin).toEqual({
      status: 'success',
      data: beginPayload,
      errorCode: null,
    });
    expect(useLockStore.getState().lockChallenge).toEqual(beginPayload.lockChallenge);

    state.failLockBegin('BAD_REQUEST');
    expect(useLockStore.getState().lockBegin).toEqual({
      status: 'error',
      data: null,
      errorCode: 'BAD_REQUEST',
    });
  });

  it('tracks lock_commit lifecycle and receiver identity data', () => {
    const state = useLockStore.getState();
    const receiverPubJwk = buildReceiverPubJwk();
    const lockedAt = UnixMsSchema.parse(1_700_000_000_000);

    state.setReceiverIdentity({
      receiverPubJwk,
      receiverPubFpr: VALID_HEX,
      lockedAt,
    });
    state.setSafetyCode(buildSafetyCodeDisplay());

    const nextState = useLockStore.getState();
    expect(nextState.receiverPubJwk).toEqual(receiverPubJwk);
    expect(nextState.receiverPubFpr).toBe(VALID_HEX);
    expect(nextState.lockedAt).toBe(lockedAt);
    expect(nextState.safetyCode).not.toBeNull();

    state.startLockCommit();
    expect(useLockStore.getState().lockCommit).toEqual({
      status: 'loading',
      data: null,
      errorCode: null,
    });

    const commitPayload = buildLockCommitResponse();
    state.completeLockCommit(commitPayload);
    expect(useLockStore.getState().lockCommit).toEqual({
      status: 'success',
      data: commitPayload,
      errorCode: null,
    });

    state.failLockCommit('LOCK_PROOF_INVALID');
    expect(useLockStore.getState().lockCommit).toEqual({
      status: 'error',
      data: null,
      errorCode: 'LOCK_PROOF_INVALID',
    });
  });

  it('resets to initial defaults', () => {
    const state = useLockStore.getState();
    state.setLockUuid(VALID_UUID);
    state.setStep('lock');
    state.setPassphrase('Strong#Pass1234');
    state.completeLockBegin(buildLockBeginResponse());
    state.setReceiverIdentity({
      receiverPubJwk: buildReceiverPubJwk(),
      receiverPubFpr: VALID_HEX,
      lockedAt: UnixMsSchema.parse(1_700_000_000_000),
    });
    state.completeLockCommit(buildLockCommitResponse());

    state.resetLockStore();

    const nextState = useLockStore.getState();
    expect(nextState.uuid).toBeNull();
    expect(nextState.step).toBe('onboarding');
    expect(nextState.passphrase).toBe('');
    expect(nextState.lockChallenge).toBeNull();
    expect(nextState.receiverPubJwk).toBeNull();
    expect(nextState.receiverPubFpr).toBeNull();
    expect(nextState.lockedAt).toBeNull();
    expect(nextState.safetyCode).toBeNull();
    expect(nextState.lockBegin).toEqual({ status: 'idle', data: null, errorCode: null });
    expect(nextState.lockCommit).toEqual({ status: 'idle', data: null, errorCode: null });
  });
});
