import {
  CreateBeginResponseSchema,
  CreateFinishResponseSchema,
  SECURITY_PROFILE,
} from '@zerolink/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { useCreateStore } from '../stores/create-store';

const IDLE_REQUEST_STATE = {
  status: 'idle',
  data: null,
  errorCode: null,
} as const;

function buildCreateBeginResponse() {
  return CreateBeginResponseSchema.parse({
    ok: true,
    creationOptions: {
      challenge: 'bW9ja19jaGFsbGVuZ2U',
    },
  });
}

function buildCreateFinishResponse() {
  return CreateFinishResponseSchema.parse({
    ok: true,
    shareUrl: '/s/aaaaaaaaaaaaaaaaaaaaa#k=bW9ja19rZXk',
    manageUrl: '/m/aaaaaaaaaaaaaaaaaaaaa',
  });
}

beforeEach(() => {
  useCreateStore.getState().resetCreateStore();
});

describe('useCreateStore', () => {
  it('uses expected defaults', () => {
    const state = useCreateStore.getState();

    expect(state.selectedProfile).toBe(SECURITY_PROFILE.QUICK);
    expect(state.webAuthnSupported).toBe(false);
    expect(state.createdProfile).toBeNull();
    expect(state.createBegin).toEqual(IDLE_REQUEST_STATE);
    expect(state.createFinish).toEqual(IDLE_REQUEST_STATE);
  });

  it('resets transient state when changing selected profile', () => {
    const state = useCreateStore.getState();
    state.setCreatedProfile(SECURITY_PROFILE.QUICK);
    state.completeCreateBegin(buildCreateBeginResponse());
    state.failCreateFinish('PREVIOUS_ERROR');

    state.setSelectedProfile(SECURITY_PROFILE.SECURE);

    const nextState = useCreateStore.getState();
    expect(nextState.selectedProfile).toBe(SECURITY_PROFILE.SECURE);
    expect(nextState.createdProfile).toBeNull();
    expect(nextState.createBegin).toEqual(IDLE_REQUEST_STATE);
    expect(nextState.createFinish).toEqual(IDLE_REQUEST_STATE);
  });

  it('tracks create_begin request lifecycle', () => {
    const state = useCreateStore.getState();

    state.startCreateBegin();
    expect(useCreateStore.getState().createBegin).toEqual({
      status: 'loading',
      data: null,
      errorCode: null,
    });

    const successPayload = buildCreateBeginResponse();
    state.completeCreateBegin(successPayload);
    expect(useCreateStore.getState().createBegin).toEqual({
      status: 'success',
      data: successPayload,
      errorCode: null,
    });

    state.failCreateBegin('BAD_REQUEST');
    expect(useCreateStore.getState().createBegin).toEqual({
      status: 'error',
      data: null,
      errorCode: 'BAD_REQUEST',
    });
  });

  it('tracks create_finish request lifecycle', () => {
    const state = useCreateStore.getState();

    state.startCreateFinish();
    expect(useCreateStore.getState().createFinish).toEqual({
      status: 'loading',
      data: null,
      errorCode: null,
    });

    const successPayload = buildCreateFinishResponse();
    state.completeCreateFinish(successPayload);
    expect(useCreateStore.getState().createFinish).toEqual({
      status: 'success',
      data: successPayload,
      errorCode: null,
    });

    state.failCreateFinish('INVALID_ASSERTION');
    expect(useCreateStore.getState().createFinish).toEqual({
      status: 'error',
      data: null,
      errorCode: 'INVALID_ASSERTION',
    });
  });

  it('resets to initial defaults', () => {
    const state = useCreateStore.getState();
    state.setSelectedProfile(SECURITY_PROFILE.SECURE);
    state.setWebAuthnSupported(true);
    state.setCreatedProfile(SECURITY_PROFILE.SECURE);
    state.startCreateBegin();
    state.startCreateFinish();

    state.resetCreateStore();

    const nextState = useCreateStore.getState();
    expect(nextState.selectedProfile).toBe(SECURITY_PROFILE.QUICK);
    expect(nextState.webAuthnSupported).toBe(false);
    expect(nextState.createdProfile).toBeNull();
    expect(nextState.createBegin).toEqual(IDLE_REQUEST_STATE);
    expect(nextState.createFinish).toEqual(IDLE_REQUEST_STATE);
  });
});
