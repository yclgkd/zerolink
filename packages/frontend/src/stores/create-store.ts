import {
  type CreateBeginResponse,
  type CreateFinishResponse,
  SECURITY_PROFILE,
  type SecurityProfile,
} from '@zerolink/shared';
import { create } from 'zustand';

import { type AsyncRequestState, createIdleRequestState } from './request-state';

export interface CreateStoreState {
  selectedProfile: SecurityProfile;
  webAuthnSupported: boolean;
  showCompatibilityConfirm: boolean;
  compatibilityAccepted: boolean;
  createdProfile: SecurityProfile | null;
  createBegin: AsyncRequestState<CreateBeginResponse>;
  createFinish: AsyncRequestState<CreateFinishResponse>;
}

export interface CreateStoreActions {
  setSelectedProfile: (profile: SecurityProfile) => void;
  setWebAuthnSupported: (supported: boolean) => void;
  setShowCompatibilityConfirm: (show: boolean) => void;
  setCompatibilityAccepted: (accepted: boolean) => void;
  startCreateBegin: () => void;
  completeCreateBegin: (payload: CreateBeginResponse) => void;
  failCreateBegin: (errorCode: string) => void;
  startCreateFinish: () => void;
  completeCreateFinish: (payload: CreateFinishResponse) => void;
  failCreateFinish: (errorCode: string) => void;
  setCreatedProfile: (profile: SecurityProfile | null) => void;
  resetCreateStore: () => void;
}

export type CreateStore = CreateStoreState & CreateStoreActions;

function createInitialState(): CreateStoreState {
  return {
    selectedProfile: SECURITY_PROFILE.STANDARD,
    webAuthnSupported: false,
    showCompatibilityConfirm: false,
    compatibilityAccepted: false,
    createdProfile: null,
    createBegin: createIdleRequestState<CreateBeginResponse>(),
    createFinish: createIdleRequestState<CreateFinishResponse>(),
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

export const useCreateStore = create<CreateStore>((set) => ({
  ...createInitialState(),

  setSelectedProfile: (profile) =>
    set(() => ({
      selectedProfile: profile,
      showCompatibilityConfirm: false,
      compatibilityAccepted: false,
      createdProfile: null,
      createBegin: createIdleRequestState<CreateBeginResponse>(),
      createFinish: createIdleRequestState<CreateFinishResponse>(),
    })),

  setWebAuthnSupported: (supported) => set(() => ({ webAuthnSupported: supported })),

  setShowCompatibilityConfirm: (show) => set(() => ({ showCompatibilityConfirm: show })),

  setCompatibilityAccepted: (accepted) => set(() => ({ compatibilityAccepted: accepted })),

  startCreateBegin: () => set(() => ({ createBegin: createLoadingState<CreateBeginResponse>() })),

  completeCreateBegin: (payload) =>
    set(() => ({ createBegin: createSuccessState<CreateBeginResponse>(payload) })),

  failCreateBegin: (errorCode) =>
    set(() => ({ createBegin: createErrorState<CreateBeginResponse>(errorCode) })),

  startCreateFinish: () =>
    set(() => ({ createFinish: createLoadingState<CreateFinishResponse>() })),

  completeCreateFinish: (payload) =>
    set(() => ({ createFinish: createSuccessState<CreateFinishResponse>(payload) })),

  failCreateFinish: (errorCode) =>
    set(() => ({ createFinish: createErrorState<CreateFinishResponse>(errorCode) })),

  setCreatedProfile: (profile) => set(() => ({ createdProfile: profile })),

  resetCreateStore: () => set(createInitialState()),
}));
