import {
  type AdminMode,
  CHANNEL_STATE,
  type ChannelState,
  type CompoundBeginResponse,
  type CompoundChallenge,
  type CompoundCommitResponse,
  type HexString,
  type RSAPublicKeyJWK,
  type SecurityProfile,
  type UUID,
} from '@zerolink/shared';
import { create } from 'zustand';

import {
  type AsyncRequestState,
  createErrorState,
  createIdleRequestState,
  createLoadingState,
  createSuccessState,
} from './request-state';

/**
 * State properties for the sender-side channel management and delivery flow.
 */
export interface DeliverStoreState {
  uuid: UUID | null;
  channelState: ChannelState;
  adminMode: AdminMode | null;
  securityProfile: SecurityProfile | null;
  showDestroyConfirm: boolean;
  copied: boolean;
  compoundBegin: AsyncRequestState<CompoundBeginResponse>;
  compoundCommit: AsyncRequestState<CompoundCommitResponse>;
  challenge: CompoundChallenge | null;
  currentVersion: number | null;
  receiverPubFpr: HexString | null;
  receiverPubJwk: RSAPublicKeyJWK | null;
}

/**
 * Action modifiers for the sender-side channel management and delivery flow.
 */
export interface DeliverStoreActions {
  setDeliverUuid: (uuid: UUID | null) => void;
  setChannelState: (state: ChannelState) => void;
  setAdminMode: (mode: AdminMode | null) => void;
  setSecurityProfile: (profile: SecurityProfile | null) => void;
  setReceiverPubFpr: (fpr: HexString | null) => void;
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

/**
 * Combined store type for channel management.
 */
export type DeliverStore = DeliverStoreState & DeliverStoreActions;

function createInitialState(): DeliverStoreState {
  return {
    uuid: null,
    channelState: CHANNEL_STATE.WAITING,
    adminMode: null,
    securityProfile: null,
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

/**
 * Zustand store managing the sender-side delivery and destruction process.
 */
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

  setAdminMode: (mode) => set(() => ({ adminMode: mode })),

  setSecurityProfile: (profile) => set(() => ({ securityProfile: profile })),

  setReceiverPubFpr: (fpr) => set(() => ({ receiverPubFpr: fpr })),

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
      securityProfile: payload.securityProfile,
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
    set(() => ({
      compoundCommit: createLoadingState<CompoundCommitResponse>(),
    })),

  completeCompoundCommit: (payload) =>
    set(() => ({
      compoundCommit: createSuccessState<CompoundCommitResponse>(payload),
    })),

  failCompoundCommit: (errorCode) =>
    set(() => ({
      compoundCommit: createErrorState<CompoundCommitResponse>(errorCode),
    })),

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
