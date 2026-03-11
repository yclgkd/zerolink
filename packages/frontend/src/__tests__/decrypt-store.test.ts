import {
  CHANNEL_STATE,
  DecryptFetchResponseSchema,
  PublicStatusResponseSchema,
  SECURITY_PROFILE,
  UUIDSchema,
} from '@zerolink/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDecryptStore } from '../stores/decrypt-store';

const VALID_UUID = UUIDSchema.parse('aaaaaaaaaaaaaaaaaaaaa');
const NEXT_UUID = UUIDSchema.parse('bbbbbbbbbbbbbbbbbbbbb');
const VALID_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_B64U = 'bW9ja19iYXNlNjR1cmw';

function buildPublicStatusResponse() {
  return PublicStatusResponseSchema.parse({
    ok: true,
    state: CHANNEL_STATE.DELIVERED,
    adminMode: 'webauthn',
    securityProfile: SECURITY_PROFILE.SECURE,
  });
}

function buildDecryptFetchResponse() {
  return DecryptFetchResponseSchema.parse({
    ok: true,
    cipherBundle: {
      ciphertext: VALID_B64U,
      iv: VALID_B64U,
      aad: VALID_B64U,
      encContentKey: VALID_B64U,
      ciphertextHash: VALID_HEX,
      padBlock: 4096,
    },
    receiverPubFpr: VALID_HEX,
    deliveredAt: 1_700_000_000_000,
  });
}

beforeEach(() => {
  useDecryptStore.getState().resetDecryptStore();
});

describe('useDecryptStore', () => {
  it('uses expected defaults', () => {
    const state = useDecryptStore.getState();

    expect(state.uuid).toBeNull();
    expect(state.channelState).toBe(CHANNEL_STATE.WAITING);
    expect(state.publicStatus).toEqual({ status: 'idle', data: null, errorCode: null });
    expect(state.decryptFetch).toEqual({ status: 'idle', data: null, errorCode: null });
    expect(state.plaintext).toBeNull();
    expect(state.localPlaintextBurned).toBe(false);
  });

  it('tracks public status request and syncs channel state', () => {
    const state = useDecryptStore.getState();
    state.setDecryptUuid(VALID_UUID);

    state.startPublicStatus();
    expect(useDecryptStore.getState().publicStatus).toEqual({
      status: 'loading',
      data: null,
      errorCode: null,
    });

    const publicStatusPayload = buildPublicStatusResponse();
    state.completePublicStatus(publicStatusPayload);
    expect(useDecryptStore.getState().publicStatus).toEqual({
      status: 'success',
      data: publicStatusPayload,
      errorCode: null,
    });
    expect(useDecryptStore.getState().channelState).toBe(CHANNEL_STATE.DELIVERED);

    state.failPublicStatus('STATUS_FETCH_FAILED');
    expect(useDecryptStore.getState().publicStatus).toEqual({
      status: 'error',
      data: null,
      errorCode: 'STATUS_FETCH_FAILED',
    });
    expect(useDecryptStore.getState().channelState).toBe(CHANNEL_STATE.WAITING);
  });

  it('tracks decrypt_fetch lifecycle', () => {
    const state = useDecryptStore.getState();

    state.startDecryptFetch();
    expect(useDecryptStore.getState().decryptFetch).toEqual({
      status: 'loading',
      data: null,
      errorCode: null,
    });

    const decryptPayload = buildDecryptFetchResponse();
    state.completeDecryptFetch(decryptPayload);
    expect(useDecryptStore.getState().decryptFetch).toEqual({
      status: 'success',
      data: decryptPayload,
      errorCode: null,
    });

    state.failDecryptFetch('DECRYPT_FETCH_FAILED');
    expect(useDecryptStore.getState().decryptFetch).toEqual({
      status: 'error',
      data: null,
      errorCode: 'DECRYPT_FETCH_FAILED',
    });
  });

  it('stores plaintext and marks local plaintext burned state', () => {
    const state = useDecryptStore.getState();
    state.setPlaintext('secret payload');
    expect(useDecryptStore.getState().plaintext).toBe('secret payload');
    expect(useDecryptStore.getState().localPlaintextBurned).toBe(false);

    state.markLocalPlaintextBurned();
    expect(useDecryptStore.getState().localPlaintextBurned).toBe(true);
    expect(useDecryptStore.getState().plaintext).toBeNull();
  });

  it('resets channel-scoped state when uuid changes', () => {
    const state = useDecryptStore.getState();

    state.setDecryptUuid(VALID_UUID);
    state.completePublicStatus(buildPublicStatusResponse());
    state.completeDecryptFetch(buildDecryptFetchResponse());
    state.setPlaintext('secret payload');
    state.markLocalPlaintextBurned();

    state.setDecryptUuid(NEXT_UUID);

    const nextState = useDecryptStore.getState();
    expect(nextState.uuid).toBe(NEXT_UUID);
    expect(nextState.channelState).toBe(CHANNEL_STATE.WAITING);
    expect(nextState.publicStatus).toEqual({ status: 'idle', data: null, errorCode: null });
    expect(nextState.decryptFetch).toEqual({ status: 'idle', data: null, errorCode: null });
    expect(nextState.plaintext).toBeNull();
    expect(nextState.localPlaintextBurned).toBe(false);
  });

  it('does not reset when uuid is unchanged', () => {
    const state = useDecryptStore.getState();

    state.setDecryptUuid(VALID_UUID);
    state.completePublicStatus(buildPublicStatusResponse());
    state.completeDecryptFetch(buildDecryptFetchResponse());
    state.setPlaintext('secret payload');

    state.setDecryptUuid(VALID_UUID);

    const nextState = useDecryptStore.getState();
    expect(nextState.uuid).toBe(VALID_UUID);
    expect(nextState.channelState).toBe(CHANNEL_STATE.DELIVERED);
    expect(nextState.publicStatus.status).toBe('success');
    expect(nextState.decryptFetch.status).toBe('success');
    expect(nextState.plaintext).toBe('secret payload');
    expect(nextState.localPlaintextBurned).toBe(false);
  });

  it('resets to initial defaults', () => {
    const state = useDecryptStore.getState();
    state.setDecryptUuid(VALID_UUID);
    state.completePublicStatus(buildPublicStatusResponse());
    state.completeDecryptFetch(buildDecryptFetchResponse());
    state.setPlaintext('secret payload');
    state.markLocalPlaintextBurned();

    state.resetDecryptStore();

    const nextState = useDecryptStore.getState();
    expect(nextState.uuid).toBeNull();
    expect(nextState.channelState).toBe(CHANNEL_STATE.WAITING);
    expect(nextState.publicStatus).toEqual({ status: 'idle', data: null, errorCode: null });
    expect(nextState.decryptFetch).toEqual({ status: 'idle', data: null, errorCode: null });
    expect(nextState.plaintext).toBeNull();
    expect(nextState.localPlaintextBurned).toBe(false);
  });
});
