import {
  CHANNEL_STATE,
  type ChannelState,
  type CompoundBeginResponse,
  type CompoundChallenge,
  type CompoundCommitResponse,
  type HexString,
  type RSAPublicKeyJWK,
  type UUID,
} from '@zerolink/shared';
import { create } from 'zustand';

import { type AsyncRequestState, createIdleRequestState } from './request-state';

export interface DeliverStoreState {
  uuid: UUID | null;
  channelState: ChannelState;
  showDestroyConfirm: boolean;
  copied: boolean;
  compoundBegin: AsyncRequestState<CompoundBeginResponse>;
  compoundCommit: AsyncRequestState<CompoundCommitResponse>;
  challenge: CompoundChallenge | null;
  currentVersion: number | null;
  receiverPubFpr: HexString | null;
  receiverPubJwk: RSAPublicKeyJWK | null;
}

export interface DeliverStoreActions {
  setDeliverUuid: (uuid: UUID | null) => void;
  setChannelState: (state: ChannelState) => void;
  setShowDestroyConfirm: (show: boolean) => void;
  setCopied: (copied: boolean) => void;
  startCompoundBegin: () => void;
  completeCompoundBegin: (payload: CompoundBeginResponse) => void;
  failCompoundBegin: (errorCode: string) => void;
  startCompoundCommit: () => void;
  completeCompoundCommit: (payload: CompoundCommitResponse) => void;
  failCompoundCommit: (errorCode: string) => void;
  markDelivered: () => void;
  markDeleted: () => void;
  resetDeliverStore: () => void;
}

export type DeliverStore = DeliverStoreState & DeliverStoreActions;

function createInitialState(): DeliverStoreState {
  return {
    uuid: null,
    channelState: CHANNEL_STATE.WAITING,
    showDestroyConfirm: false,
    copied: false,
    compoundBegin: createIdleRequestState<CompoundBeginResponse>(),
    compoundCommit: createIdleRequestState<CompoundCommitResponse>(),
    challenge: null,
    currentVersion: null,
    receiverPubFpr: null,
    receiverPubJwk: null,
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

export const useDeliverStore = create<DeliverStore>((set, get) => ({
  ...createInitialState(),

  setDeliverUuid: (uuid) => {
    if (get().uuid === uuid) return;
    set(() => ({
      ...createInitialState(),
      uuid,
    }));
  },

  setChannelState: (state) =>
    set(() => ({
      channelState: state,
      showDestroyConfirm: false,
    })),

  setShowDestroyConfirm: (show) => set(() => ({ showDestroyConfirm: show })),

  setCopied: (copied) => set(() => ({ copied })),

  startCompoundBegin: () =>
    set(() => ({
      compoundBegin: createLoadingState<CompoundBeginResponse>(),
      challenge: null,
      currentVersion: null,
      receiverPubFpr: null,
      receiverPubJwk: null,
    })),

  completeCompoundBegin: (payload) =>
    set(() => ({
      compoundBegin: createSuccessState<CompoundBeginResponse>(payload),
      challenge: payload.challenge,
      currentVersion: payload.currentVersion,
      receiverPubFpr: payload.receiverPubFpr ?? null,
      receiverPubJwk: payload.receiverPubJwk ?? null,
    })),

  failCompoundBegin: (errorCode) =>
    set(() => ({
      compoundBegin: createErrorState<CompoundBeginResponse>(errorCode),
      challenge: null,
      currentVersion: null,
      receiverPubFpr: null,
      receiverPubJwk: null,
    })),

  startCompoundCommit: () =>
    set(() => ({ compoundCommit: createLoadingState<CompoundCommitResponse>() })),

  completeCompoundCommit: (payload) =>
    set(() => ({ compoundCommit: createSuccessState<CompoundCommitResponse>(payload) })),

  failCompoundCommit: (errorCode) =>
    set(() => ({ compoundCommit: createErrorState<CompoundCommitResponse>(errorCode) })),

  markDelivered: () =>
    set(() => ({
      channelState: CHANNEL_STATE.DELIVERED,
      showDestroyConfirm: false,
    })),

  markDeleted: () =>
    set(() => ({
      channelState: CHANNEL_STATE.DELETED,
      showDestroyConfirm: false,
    })),

  resetDeliverStore: () => set(createInitialState()),
}));
