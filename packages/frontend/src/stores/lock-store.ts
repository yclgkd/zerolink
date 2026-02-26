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

import {
  type AsyncRequestState,
  createErrorState,
  createIdleRequestState,
  createLoadingState,
  createSuccessState,
} from './request-state';

export type LockFlowStep = 'onboarding' | 'lock' | 'locked';

/**
 * State properties for the receiver-side channel lock flow.
 */
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

/**
 * Action modifiers for the receiver-side channel lock flow.
 */
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

/**
 * Combined store type for channel locking.
 */
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

/**
 * Zustand store managing the receiver-side key generation and channel locking process.
 */
export const useLockStore = create<LockStore>((set, get) => ({
  ...createInitialState(),

  setLockUuid: (uuid) => {
    if (get().uuid === uuid) return;
    set(() => ({
      ...createInitialState(),
      uuid,
    }));
  },

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
