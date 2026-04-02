import { CHANNEL_STATE, parseManageFragment, UUIDSchema } from '@zerolink/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiClient } from '../../api/client';
import { deriveSafetyCodeDisplay } from '../../crypto/safety-code-derive';
import { deserializeWrappedKeyCompact } from '../../crypto/wrapped-key-codec';
import { useDeliverStore } from '../../stores/deliver-store';
import type { ChannelClosedReason, ChannelStateUpdate } from '../../sync/channel-sync.ts';
import { useChannelSync } from '../../sync/use-channel-sync.ts';
import { canComposeDelivery, isTerminalManageState, mapActionError } from './manage-utils';
import { useManageDeliveryLogic, useManageDestructionLogic } from './use-manage-actions';
import { usePublicStatusFetcher } from './use-manage-status';

export function useManagePageState(uuid?: string) {
  const location = useLocation();
  const store = useDeliverStore();
  const mountedRef = useRef(true);
  const actionScopeRef = useRef(0);
  const latestManageHashRef = useRef(location.hash);

  const [deliveryMode, setDeliveryMode] = useState<'text' | 'file'>('text');
  const [filePolicyMaxBytes, setFilePolicyMaxBytes] = useState<number | null>(null);
  const filePolicyFetchedRef = useRef(false);
  const [secretInput, setSecretInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [softkeyPassphrase, setSoftkeyPassphrase] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSecretInputInvalid, setIsSecretInputInvalid] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);

  const getWrappedPrivateKey = useCallback(() => {
    const currentHash =
      typeof window !== 'undefined' && window.location.hash
        ? window.location.hash
        : latestManageHashRef.current;
    const { wrappedKeyCompact } = parseManageFragment(currentHash);
    if (!wrappedKeyCompact) {
      return undefined;
    }

    return deserializeWrappedKeyCompact(wrappedKeyCompact) ?? undefined;
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    latestManageHashRef.current = location.hash;
  }, [location.hash]);

  const {
    isUnavailable,
    publicStatusError,
    statusConfirmed,
    setPublicStatusError,
    setIsUnavailable,
    setStatusConfirmed,
  } = usePublicStatusFetcher(uuid, mountedRef);

  // Real-time sync: auto-update when receiver locks or channel state changes
  useChannelSync(uuid, {
    onStateChange: useCallback(
      (update: ChannelStateUpdate) => {
        if (!mountedRef.current) return;
        setIsUnavailable(false);
        setPublicStatusError(null);
        setStatusConfirmed(true);
        store.setChannelState(update.state);
        store.setAdminMode(update.adminMode);
        store.setSecurityProfile(update.securityProfile);
        store.setReceiverPubFpr(update.receiverPubFpr ?? null);
      },
      [
        setIsUnavailable,
        setPublicStatusError,
        setStatusConfirmed,
        store.setChannelState,
        store.setAdminMode,
        store.setSecurityProfile,
        store.setReceiverPubFpr,
      ]
    ),
    onChannelClosed: useCallback(
      (_reason: ChannelClosedReason) => {
        if (!mountedRef.current) return;
        const latestState = useDeliverStore.getState().channelState;
        setPublicStatusError(null);
        store.setShowDestroyConfirm(false);
        if (latestState === CHANNEL_STATE.DELETED) {
          setIsUnavailable(false);
          return;
        }

        setIsUnavailable(true);
        store.setChannelState(CHANNEL_STATE.WAITING);
        store.setAdminMode(null);
        store.setSecurityProfile(null);
        store.setReceiverPubFpr(null);
      },
      [
        setPublicStatusError,
        setIsUnavailable,
        store.setChannelState,
        store.setShowDestroyConfirm,
        store.setAdminMode,
        store.setSecurityProfile,
        store.setReceiverPubFpr,
      ]
    ),
  });

  useEffect(() => {
    actionScopeRef.current += 1;
    setIsActionPending(false);
    setDeliveryMode('text');
    setSecretInput('');
    setSelectedFile(null);
    setSoftkeyPassphrase('');
    setActionError(null);
    setIsSecretInputInvalid(false);
    setPublicStatusError(null);

    if (!uuid) {
      store.setDeliverUuid(null);
      return;
    }
    const parsedUuid = UUIDSchema.safeParse(uuid);
    store.setDeliverUuid(parsedUuid.success ? parsedUuid.data : null);
    store.setShowDestroyConfirm(false);
  }, [uuid, store.setDeliverUuid, store.setShowDestroyConfirm, setPublicStatusError]);

  useEffect(() => {
    return () => store.resetDeliverStore();
  }, [store.resetDeliverStore]);

  const safetyCode = useMemo(() => {
    if (!store.receiverPubFpr) return null;
    try {
      return deriveSafetyCodeDisplay(store.receiverPubFpr);
    } catch (error: unknown) {
      // biome-ignore lint/suspicious/noConsole: runtime error logging for safety code derivation failures
      console.error('[useManagePageState] deriveSafetyCodeDisplay failed', {
        receiverPubFpr: store.receiverPubFpr,
        error,
      });
      return null;
    }
  }, [store.receiverPubFpr]);

  const profile = store.securityProfile;
  const canManageActions =
    !isUnavailable &&
    store.channelState !== CHANNEL_STATE.DELETED &&
    store.channelState !== CHANNEL_STATE.EXPIRED &&
    profile !== null &&
    Boolean(store.uuid);
  const canDeliver =
    canManageActions &&
    (deliveryMode === 'text' ? secretInput.trim().length > 0 : selectedFile !== null);

  const { handleDeliver, isActiveActionContext } = useManageDeliveryLogic(
    mountedRef,
    actionScopeRef,
    isActionPending,
    setIsActionPending,
    setActionError,
    setIsSecretInputInvalid,
    secretInput,
    selectedFile,
    softkeyPassphrase,
    profile,
    getWrappedPrivateKey,
    setSecretInput,
    setSelectedFile,
    setSoftkeyPassphrase
  );

  const { handleDestroyConfirm, handleApplyDestroy } = useManageDestructionLogic(
    mountedRef,
    actionScopeRef,
    isActionPending,
    setIsActionPending,
    setActionError,
    setIsSecretInputInvalid,
    setSecretInput,
    setSoftkeyPassphrase,
    softkeyPassphrase,
    profile,
    isActiveActionContext,
    getWrappedPrivateKey
  );

  return {
    status: store.channelState,
    adminMode: store.adminMode,
    showDestroyConfirm: store.showDestroyConfirm,
    deliveryMode,
    filePolicyMaxBytes,
    secretInput,
    selectedFile,
    softkeyPassphrase,
    safetyCode,
    actionError,
    isSecretInputInvalid,
    isUnavailable,
    publicStatusError,
    statusConfirmed,
    isActionPending,
    canManageActions,
    canDeliver,
    handleModeChange: (mode: 'text' | 'file') => {
      setDeliveryMode(mode);
      setActionError(null);
      setIsSecretInputInvalid(false);
      if (mode === 'text') {
        setSelectedFile(null);
      } else {
        setSecretInput('');
        if (!filePolicyFetchedRef.current) {
          filePolicyFetchedRef.current = true;
          void apiClient.filePolicy().then((result) => {
            if (!mountedRef.current) return;
            if (result.ok) {
              setFilePolicyMaxBytes(result.data.policy.maxFileBytes);
              return;
            }
            filePolicyFetchedRef.current = false;
          });
        }
      }
    },
    handleSecretChange: (value: string) => {
      setSecretInput(value);
      if (actionError || isSecretInputInvalid) {
        setActionError(null);
        setIsSecretInputInvalid(false);
      }
    },
    handleFileSelect: (file: File | null) => {
      if (file && filePolicyMaxBytes !== null && file.size > filePolicyMaxBytes) {
        setSelectedFile(null);
        setActionError(mapActionError('FILE_TOO_LARGE'));
        setIsSecretInputInvalid(false);
        return false;
      }

      setSelectedFile(file);
      if (actionError || isSecretInputInvalid) {
        setActionError(null);
        setIsSecretInputInvalid(false);
      }
      return true;
    },
    handleSoftkeyPassphraseChange: (value: string) => {
      setSoftkeyPassphrase(value);
      if (actionError) {
        setActionError(null);
      }
    },
    handleDeliver,
    handleDestroyConfirm,
    handleCancelDestroy: () => store.setShowDestroyConfirm(false),
    handleApplyDestroy,
  };
}

export { canComposeDelivery, isTerminalManageState };
