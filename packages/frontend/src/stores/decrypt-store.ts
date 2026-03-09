import {
  CHANNEL_STATE,
  type ChannelState,
  type DecryptFetchResponse,
  type PublicStatusResponse,
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
 * State properties for the receiver decrypt flow.
 */
export interface DecryptStoreState {
  uuid: UUID | null;
  channelState: ChannelState;
  publicStatus: AsyncRequestState<PublicStatusResponse>;
  decryptFetch: AsyncRequestState<DecryptFetchResponse>;
  plaintext: string | null;
  localPlaintextBurned: boolean;
}

/**
 * Action modifiers for the receiver decrypt flow.
 */
export interface DecryptStoreActions {
  setDecryptUuid: (uuid: UUID | null) => void;
  startPublicStatus: () => void;
  completePublicStatus: (payload: PublicStatusResponse) => void;
  failPublicStatus: (errorCode: string) => void;
  startDecryptFetch: () => void;
  completeDecryptFetch: (payload: DecryptFetchResponse) => void;
  failDecryptFetch: (errorCode: string) => void;
  setPlaintext: (plaintext: string | null) => void;
  markLocalPlaintextBurned: () => void;
  resetDecryptStore: () => void;
}

/**
 * Combined store type for the decryption lifecycle.
 */
export type DecryptStore = DecryptStoreState & DecryptStoreActions;

function createInitialState(): DecryptStoreState {
  return {
    uuid: null,
    channelState: CHANNEL_STATE.WAITING,
    publicStatus: createIdleRequestState<PublicStatusResponse>(),
    decryptFetch: createIdleRequestState<DecryptFetchResponse>(),
    plaintext: null,
    localPlaintextBurned: false,
  };
}

/**
 * Zustand store managing the receiver-side payload fetching and decryption.
 */
export const useDecryptStore = create<DecryptStore>((set, get) => ({
  ...createInitialState(),

  setDecryptUuid: (uuid) => {
    if (get().uuid === uuid) return;
    set(() => ({
      ...createInitialState(),
      uuid,
    }));
  },

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
      localPlaintextBurned: false,
    })),

  markLocalPlaintextBurned: () =>
    set(() => ({
      localPlaintextBurned: true,
      plaintext: null,
    })),

  resetDecryptStore: () => set(createInitialState()),
}));
