import {
  CHANNEL_STATE,
  type ChannelState,
  type DecryptFetchResponse,
  type PublicStatusResponse,
  type UUID,
} from '@zerolink/shared';
import { create } from 'zustand';

import { type AsyncRequestState, createIdleRequestState } from './request-state';

export interface DecryptStoreState {
  uuid: UUID | null;
  channelState: ChannelState;
  publicStatus: AsyncRequestState<PublicStatusResponse>;
  decryptFetch: AsyncRequestState<DecryptFetchResponse>;
  plaintext: string | null;
  burned: boolean;
}

export interface DecryptStoreActions {
  setDecryptUuid: (uuid: UUID | null) => void;
  startPublicStatus: () => void;
  completePublicStatus: (payload: PublicStatusResponse) => void;
  failPublicStatus: (errorCode: string) => void;
  startDecryptFetch: () => void;
  completeDecryptFetch: (payload: DecryptFetchResponse) => void;
  failDecryptFetch: (errorCode: string) => void;
  setPlaintext: (plaintext: string | null) => void;
  markBurned: () => void;
  resetDecryptStore: () => void;
}

export type DecryptStore = DecryptStoreState & DecryptStoreActions;

function createInitialState(): DecryptStoreState {
  return {
    uuid: null,
    channelState: CHANNEL_STATE.WAITING,
    publicStatus: createIdleRequestState<PublicStatusResponse>(),
    decryptFetch: createIdleRequestState<DecryptFetchResponse>(),
    plaintext: null,
    burned: false,
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

export const useDecryptStore = create<DecryptStore>((set) => ({
  ...createInitialState(),

  setDecryptUuid: (uuid) => set(() => ({ uuid })),

  startPublicStatus: () =>
    set(() => ({ publicStatus: createLoadingState<PublicStatusResponse>() })),

  completePublicStatus: (payload) =>
    set(() => ({
      publicStatus: createSuccessState<PublicStatusResponse>(payload),
      channelState: payload.state,
    })),

  failPublicStatus: (errorCode) =>
    set(() => ({
      publicStatus: createErrorState<PublicStatusResponse>(errorCode),
      channelState: CHANNEL_STATE.WAITING,
    })),

  startDecryptFetch: () =>
    set(() => ({ decryptFetch: createLoadingState<DecryptFetchResponse>() })),

  completeDecryptFetch: (payload) =>
    set(() => ({ decryptFetch: createSuccessState<DecryptFetchResponse>(payload) })),

  failDecryptFetch: (errorCode) =>
    set(() => ({ decryptFetch: createErrorState<DecryptFetchResponse>(errorCode) })),

  setPlaintext: (plaintext) =>
    set(() => ({
      plaintext,
      burned: false,
    })),

  markBurned: () =>
    set(() => ({
      burned: true,
      plaintext: null,
    })),

  resetDecryptStore: () => set(createInitialState()),
}));
