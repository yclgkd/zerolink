import { CHANNEL_STATE, parseManageFragment, UUIDSchema } from '@zerolink/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deriveSafetyCodeDisplay } from '../../crypto/safety-code-derive';
import { deserializeWrappedKeyCompact } from '../../crypto/wrapped-key-codec';
import { useDeliverStore } from '../../stores/deliver-store';
import type { ChannelClosedReason, ChannelStateUpdate } from '../../sync/channel-sync.ts';
import { useChannelSync } from '../../sync/use-channel-sync.ts';
import { canComposeDelivery, isTerminalManageState } from './manage-utils';
import { useManageDeliveryLogic, useManageDestructionLogic } from './use-manage-actions';
import { usePublicStatusFetcher } from './use-manage-status';

export function useManagePageState(uuid?: string) {
  const store = useDeliverStore();
  const mountedRef = useRef(true);
  const actionScopeRef = useRef(0);

  const [secretInput, setSecretInput] = useState('');
  const [softkeyPassphrase, setSoftkeyPassphrase] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSecretInputInvalid, setIsSecretInputInvalid] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);

  const wrappedPrivateKey = useMemo(() => {
    const { wrappedKeyCompact } = parseManageFragment(window.location.hash);
    if (!wrappedKeyCompact) return undefined;
    return deserializeWrappedKeyCompact(wrappedKeyCompact) ?? undefined;
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { isUnavailable, publicStatusError, setPublicStatusError, setIsUnavailable } =
    usePublicStatusFetcher(uuid, mountedRef);

  // Real-time sync: auto-update when receiver locks or channel state changes
  useChannelSync(uuid, {
    onStateChange: useCallback(
      (update: ChannelStateUpdate) => {
        if (!mountedRef.current) return;
        setIsUnavailable(false);
        setPublicStatusError(null);
        store.setChannelState(update.state);
        store.setAdminMode(update.adminMode);
        store.setSecurityProfile(update.securityProfile);
        store.setReceiverPubFpr(update.receiverPubFpr ?? null);
      },
      [
        setIsUnavailable,
        setPublicStatusError,
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
    setSecretInput('');
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
    } catch {
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
  const canDeliver = canManageActions && secretInput.trim().length > 0;

  const { handleDeliver, isActiveActionContext } = useManageDeliveryLogic(
    mountedRef,
    actionScopeRef,
    isActionPending,
    setIsActionPending,
    setActionError,
    setIsSecretInputInvalid,
    secretInput,
    softkeyPassphrase,
    profile,
    wrappedPrivateKey,
    setSecretInput,
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
    wrappedPrivateKey
  );

  return {
    status: store.channelState,
    adminMode: store.adminMode,
    showDestroyConfirm: store.showDestroyConfirm,
    secretInput,
    softkeyPassphrase,
    safetyCode,
    actionError,
    isSecretInputInvalid,
    isUnavailable,
    publicStatusError,
    isActionPending,
    canManageActions,
    canDeliver,
    handleSecretChange: (value: string) => {
      setSecretInput(value);
      if (actionError || isSecretInputInvalid) {
        setActionError(null);
        setIsSecretInputInvalid(false);
      }
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
