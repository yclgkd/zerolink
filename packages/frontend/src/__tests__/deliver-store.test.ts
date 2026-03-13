import {
  CHANNEL_STATE,
  type CompoundBeginResponse,
  CompoundBeginResponseSchema,
  CompoundCommitResponseSchema,
  HexStringSchema,
  SECURITY_PROFILE,
  UUIDSchema,
} from '@zerolink/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDeliverStore } from '../stores/deliver-store';

const VALID_UUID = UUIDSchema.parse('aaaaaaaaaaaaaaaaaaaaa');
const NEXT_UUID = UUIDSchema.parse('bbbbbbbbbbbbbbbbbbbbb');
const VALID_HEX = HexStringSchema.parse(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);
const NEXT_VALID_HEX = HexStringSchema.parse(
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
);
const VALID_B64U = 'bW9ja19iYXNlNjR1cmw';

function buildCompoundBeginResponse(
  overrides?: Partial<Pick<CompoundBeginResponse, 'receiverPubFpr'>>
): CompoundBeginResponse {
  const parsed = CompoundBeginResponseSchema.parse({
    ok: true,
    challenge: {
      id: VALID_B64U,
      seed: VALID_B64U,
      expiresAt: 1_700_000_000_000,
    },
    receiverPubFpr: overrides?.receiverPubFpr ?? VALID_HEX,
    receiverPubJwk: {
      kty: 'RSA',
      alg: 'RSA-OAEP-256',
      n: VALID_B64U,
      e: 'AQAB',
      ext: true,
      key_ops: ['encrypt'],
    },
    currentVersion: 3,
    securityProfile: SECURITY_PROFILE.STANDARD,
    adminMode: 'webauthn',
  });

  return {
    ok: parsed.ok,
    challenge: parsed.challenge,
    currentVersion: parsed.currentVersion,
    securityProfile: parsed.securityProfile,
    adminMode: parsed.adminMode,
    ...(parsed.receiverPubFpr ? { receiverPubFpr: parsed.receiverPubFpr } : {}),
    ...(parsed.receiverPubJwk ? { receiverPubJwk: parsed.receiverPubJwk } : {}),
  };
}

function buildCompoundCommitResponse() {
  return CompoundCommitResponseSchema.parse({
    ok: true,
  });
}

beforeEach(() => {
  useDeliverStore.getState().resetDeliverStore();
});

describe('useDeliverStore', () => {
  it('uses expected defaults', () => {
    const state = useDeliverStore.getState();

    expect(state.uuid).toBeNull();
    expect(state.channelState).toBe(CHANNEL_STATE.WAITING);
    expect(state.showDestroyConfirm).toBe(false);
    expect(state.copied).toBe(false);
    expect(state.challenge).toBeNull();
    expect(state.currentVersion).toBeNull();
    expect(state.securityProfile).toBeNull();
    expect(state.receiverPubFpr).toBeNull();
    expect(state.receiverPubJwk).toBeNull();
    expect(state.compoundBegin).toEqual({
      status: 'idle',
      data: null,
      errorCode: null,
    });
    expect(state.compoundCommit).toEqual({
      status: 'idle',
      data: null,
      errorCode: null,
    });
  });

  it('handles status transitions and keeps destroy confirm panel in sync', () => {
    const state = useDeliverStore.getState();

    state.setDeliverUuid(VALID_UUID);
    state.setShowDestroyConfirm(true);
    state.setChannelState(CHANNEL_STATE.LOCKED);

    let nextState = useDeliverStore.getState();
    expect(nextState.uuid).toBe(VALID_UUID);
    expect(nextState.channelState).toBe(CHANNEL_STATE.LOCKED);
    expect(nextState.showDestroyConfirm).toBe(false);

    state.setShowDestroyConfirm(true);
    state.markDelivered();
    nextState = useDeliverStore.getState();
    expect(nextState.channelState).toBe(CHANNEL_STATE.DELIVERED);
    expect(nextState.showDestroyConfirm).toBe(false);

    state.setShowDestroyConfirm(true);
    state.markDeleted();
    nextState = useDeliverStore.getState();
    expect(nextState.channelState).toBe(CHANNEL_STATE.DELETED);
    expect(nextState.showDestroyConfirm).toBe(false);
  });

  it('preserves a known receiver fingerprint when compound_begin starts loading', () => {
    const state = useDeliverStore.getState();
    state.setReceiverPubFpr(VALID_HEX);

    state.startCompoundBegin();
    expect(useDeliverStore.getState().compoundBegin).toEqual({
      status: 'loading',
      data: null,
      errorCode: null,
    });
    expect(useDeliverStore.getState().receiverPubFpr).toBe(VALID_HEX);
    expect(useDeliverStore.getState().challenge).toBeNull();
    expect(useDeliverStore.getState().currentVersion).toBeNull();
    expect(useDeliverStore.getState().receiverPubJwk).toBeNull();
  });

  it('preserves a known receiver fingerprint on retryable compound_begin failures', () => {
    const state = useDeliverStore.getState();
    state.setReceiverPubFpr(VALID_HEX);

    const beginPayload = buildCompoundBeginResponse();
    state.completeCompoundBegin(beginPayload);

    let nextState = useDeliverStore.getState();
    expect(nextState.compoundBegin).toEqual({
      status: 'success',
      data: beginPayload,
      errorCode: null,
    });
    expect(nextState.challenge).toEqual(beginPayload.challenge);
    expect(nextState.currentVersion).toBe(3);
    expect(nextState.securityProfile).toBe(beginPayload.securityProfile);
    expect(nextState.receiverPubFpr).toBe(beginPayload.receiverPubFpr);
    expect(nextState.receiverPubJwk).toEqual(beginPayload.receiverPubJwk);

    state.failCompoundBegin('NETWORK_ERROR');
    nextState = useDeliverStore.getState();
    expect(nextState.compoundBegin).toEqual({
      status: 'error',
      data: null,
      errorCode: 'NETWORK_ERROR',
    });
    expect(nextState.challenge).toBeNull();
    expect(nextState.currentVersion).toBeNull();
    expect(nextState.securityProfile).toBe(beginPayload.securityProfile);
    expect(nextState.receiverPubFpr).toBe(beginPayload.receiverPubFpr);
    expect(nextState.receiverPubJwk).toBeNull();
  });

  it.each([
    'NOT_FOUND',
    'LOCK_FORBIDDEN',
  ] as const)('clears a known receiver fingerprint on terminal compound_begin failure %s', (errorCode) => {
    const state = useDeliverStore.getState();

    const beginPayload = buildCompoundBeginResponse();
    state.completeCompoundBegin(beginPayload);

    state.failCompoundBegin(errorCode);

    const nextState = useDeliverStore.getState();
    expect(nextState.compoundBegin).toEqual({
      status: 'error',
      data: null,
      errorCode,
    });
    expect(nextState.challenge).toBeNull();
    expect(nextState.currentVersion).toBeNull();
    expect(nextState.securityProfile).toBe(beginPayload.securityProfile);
    expect(nextState.receiverPubFpr).toBeNull();
    expect(nextState.receiverPubJwk).toBeNull();
  });

  it('replaces receiver fingerprint with the latest compound_begin payload', () => {
    const state = useDeliverStore.getState();
    state.setReceiverPubFpr(VALID_HEX);

    const beginPayload = buildCompoundBeginResponse({ receiverPubFpr: NEXT_VALID_HEX });
    state.completeCompoundBegin(beginPayload);

    const nextState = useDeliverStore.getState();
    expect(nextState.receiverPubFpr).toBe(NEXT_VALID_HEX);
    expect(nextState.receiverPubJwk).toEqual(beginPayload.receiverPubJwk);
  });

  it('tracks compound_commit lifecycle', () => {
    const state = useDeliverStore.getState();

    state.startCompoundCommit();
    expect(useDeliverStore.getState().compoundCommit).toEqual({
      status: 'loading',
      data: null,
      errorCode: null,
    });

    const commitPayload = buildCompoundCommitResponse();
    state.completeCompoundCommit(commitPayload);
    expect(useDeliverStore.getState().compoundCommit).toEqual({
      status: 'success',
      data: commitPayload,
      errorCode: null,
    });

    state.failCompoundCommit('ASSERTION_INVALID');
    expect(useDeliverStore.getState().compoundCommit).toEqual({
      status: 'error',
      data: null,
      errorCode: 'ASSERTION_INVALID',
    });
  });

  it('resets delivery metadata when uuid changes', () => {
    const state = useDeliverStore.getState();
    state.setDeliverUuid(VALID_UUID);
    state.setChannelState(CHANNEL_STATE.LOCKED);
    state.setShowDestroyConfirm(true);
    state.setCopied(true);
    state.completeCompoundBegin(buildCompoundBeginResponse());
    state.completeCompoundCommit(buildCompoundCommitResponse());

    state.setDeliverUuid(NEXT_UUID);

    const nextState = useDeliverStore.getState();
    expect(nextState.uuid).toBe(NEXT_UUID);
    expect(nextState.channelState).toBe(CHANNEL_STATE.WAITING);
    expect(nextState.showDestroyConfirm).toBe(false);
    expect(nextState.copied).toBe(false);
    expect(nextState.challenge).toBeNull();
    expect(nextState.currentVersion).toBeNull();
    expect(nextState.securityProfile).toBeNull();
    expect(nextState.receiverPubFpr).toBeNull();
    expect(nextState.receiverPubJwk).toBeNull();
    expect(nextState.compoundBegin).toEqual({
      status: 'idle',
      data: null,
      errorCode: null,
    });
    expect(nextState.compoundCommit).toEqual({
      status: 'idle',
      data: null,
      errorCode: null,
    });
  });

  it('does not reset when uuid is unchanged', () => {
    const state = useDeliverStore.getState();
    const beginPayload = buildCompoundBeginResponse();

    state.setDeliverUuid(VALID_UUID);
    state.setChannelState(CHANNEL_STATE.LOCKED);
    state.setShowDestroyConfirm(true);
    state.setCopied(true);
    state.completeCompoundBegin(beginPayload);
    state.startCompoundCommit();

    state.setDeliverUuid(VALID_UUID);

    const nextState = useDeliverStore.getState();
    expect(nextState.uuid).toBe(VALID_UUID);
    expect(nextState.channelState).toBe(CHANNEL_STATE.LOCKED);
    expect(nextState.showDestroyConfirm).toBe(true);
    expect(nextState.copied).toBe(true);
    expect(nextState.challenge).toEqual(beginPayload.challenge);
    expect(nextState.currentVersion).toBe(beginPayload.currentVersion);
    expect(nextState.securityProfile).toBe(beginPayload.securityProfile);
    expect(nextState.receiverPubFpr).toBe(beginPayload.receiverPubFpr ?? null);
    expect(nextState.receiverPubJwk).toEqual(beginPayload.receiverPubJwk ?? null);
    expect(nextState.compoundBegin.status).toBe('success');
    expect(nextState.compoundCommit.status).toBe('loading');
  });

  it('resets to initial defaults', () => {
    const state = useDeliverStore.getState();
    state.setDeliverUuid(VALID_UUID);
    state.setChannelState(CHANNEL_STATE.LOCKED);
    state.setShowDestroyConfirm(true);
    state.setCopied(true);
    state.completeCompoundBegin(buildCompoundBeginResponse());
    state.completeCompoundCommit(buildCompoundCommitResponse());

    state.resetDeliverStore();

    const nextState = useDeliverStore.getState();
    expect(nextState.uuid).toBeNull();
    expect(nextState.channelState).toBe(CHANNEL_STATE.WAITING);
    expect(nextState.showDestroyConfirm).toBe(false);
    expect(nextState.copied).toBe(false);
    expect(nextState.challenge).toBeNull();
    expect(nextState.currentVersion).toBeNull();
    expect(nextState.securityProfile).toBeNull();
    expect(nextState.receiverPubFpr).toBeNull();
    expect(nextState.receiverPubJwk).toBeNull();
    expect(nextState.compoundBegin).toEqual({
      status: 'idle',
      data: null,
      errorCode: null,
    });
    expect(nextState.compoundCommit).toEqual({
      status: 'idle',
      data: null,
      errorCode: null,
    });
  });
});
