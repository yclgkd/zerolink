import type {
  HexString,
  LockBeginResponse,
  LockChallenge,
  LockCommitResponse,
  RSAPublicKeyJWK,
  SafetyCodeDisplay,
  UnixMs,
  UUID,
} from '@zerolink/shared';
import { create } from 'zustand';

import { type AsyncRequestState, createIdleRequestState } from './request-state';

export type LockFlowStep = 'onboarding' | 'lock' | 'locked';

export interface LockStoreState {
  uuid: UUID | null;
  step: LockFlowStep;
  passphrase: string;
  lockChallenge: LockChallenge | null;
  receiverPubJwk: RSAPublicKeyJWK | null;
  receiverPubFpr: HexString | null;
  lockedAt: UnixMs | null;
  safetyCode: SafetyCodeDisplay | null;
  lockBegin: AsyncRequestState<LockBeginResponse>;
  lockCommit: AsyncRequestState<LockCommitResponse>;
}

interface ReceiverIdentityState {
  receiverPubJwk: RSAPublicKeyJWK;
  receiverPubFpr: HexString;
  lockedAt: UnixMs;
}

export interface LockStoreActions {
  setLockUuid: (uuid: UUID | null) => void;
  setStep: (step: LockFlowStep) => void;
  setPassphrase: (passphrase: string) => void;
  clearPassphrase: () => void;
  startLockBegin: () => void;
  completeLockBegin: (payload: LockBeginResponse) => void;
  failLockBegin: (errorCode: string) => void;
  setReceiverIdentity: (identity: ReceiverIdentityState) => void;
  startLockCommit: () => void;
  completeLockCommit: (payload: LockCommitResponse) => void;
  failLockCommit: (errorCode: string) => void;
  setSafetyCode: (safetyCode: SafetyCodeDisplay | null) => void;
  markLocked: () => void;
  resetLockStore: () => void;
}

export type LockStore = LockStoreState & LockStoreActions;

function createInitialState(): LockStoreState {
  return {
    uuid: null,
    step: 'onboarding',
    passphrase: '',
    lockChallenge: null,
    receiverPubJwk: null,
    receiverPubFpr: null,
    lockedAt: null,
    safetyCode: null,
    lockBegin: createIdleRequestState<LockBeginResponse>(),
    lockCommit: createIdleRequestState<LockCommitResponse>(),
  };
}

function createLoadingState<T>(): AsyncRequestState<T> {
  return {
    status: 'loading',
    data: null,
    errorCode: null,
  };
}

function createSuccessState<T>(payload: T): AsyncRequestState<T> {
  return {
    status: 'success',
    data: payload,
    errorCode: null,
  };
}

function createErrorState<T>(errorCode: string): AsyncRequestState<T> {
  return {
    status: 'error',
    data: null,
    errorCode,
  };
}

export const useLockStore = create<LockStore>((set) => ({
  ...createInitialState(),

  setLockUuid: (uuid) => set(() => ({ uuid })),

  setStep: (step) => set(() => ({ step })),

  setPassphrase: (passphrase) => set(() => ({ passphrase })),

  clearPassphrase: () => set(() => ({ passphrase: '' })),

  startLockBegin: () =>
    set(() => ({
      lockBegin: createLoadingState<LockBeginResponse>(),
      lockChallenge: null,
    })),

  completeLockBegin: (payload) =>
    set(() => ({
      lockBegin: createSuccessState<LockBeginResponse>(payload),
      lockChallenge: payload.lockChallenge,
    })),

  failLockBegin: (errorCode) =>
    set(() => ({
      lockBegin: createErrorState<LockBeginResponse>(errorCode),
      lockChallenge: null,
    })),

  setReceiverIdentity: (identity) =>
    set(() => ({
      receiverPubJwk: identity.receiverPubJwk,
      receiverPubFpr: identity.receiverPubFpr,
      lockedAt: identity.lockedAt,
    })),

  startLockCommit: () => set(() => ({ lockCommit: createLoadingState<LockCommitResponse>() })),

  completeLockCommit: (payload) =>
    set(() => ({ lockCommit: createSuccessState<LockCommitResponse>(payload) })),

  failLockCommit: (errorCode) =>
    set(() => ({ lockCommit: createErrorState<LockCommitResponse>(errorCode) })),

  setSafetyCode: (safetyCode) => set(() => ({ safetyCode })),

  markLocked: () =>
    set(() => ({
      step: 'locked',
      passphrase: '',
    })),

  resetLockStore: () => set(createInitialState()),
}));
