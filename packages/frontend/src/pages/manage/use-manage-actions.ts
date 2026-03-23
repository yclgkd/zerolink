import { CHANNEL_STATE, type SecurityProfile, type WrappedPrivateKey } from '@zerolink/shared';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cryptoOrchestrator } from '../../crypto/orchestrator';
import { useDeliverStore } from '../../stores/deliver-store';
import {
  getChannelPasswordValidationError,
  mapActionError,
  requiresChannelPassword,
} from './manage-utils';

export function useManageDeliveryLogic(
  mountedRef: RefObject<boolean>,
  actionScopeRef: RefObject<number>,
  isActionPending: boolean,
  setIsActionPending: (pending: boolean) => void,
  setActionError: (error: string | null) => void,
  setIsSecretInputInvalid: (invalid: boolean) => void,
  secretInput: string,
  softkeyPassphrase: string,
  profile: SecurityProfile | null,
  wrappedPrivateKey: WrappedPrivateKey | undefined,
  setSecretInput: (value: string) => void,
  setSoftkeyPassphrase: (value: string) => void
) {
  const { t } = useTranslation();
  const store = useDeliverStore();

  const isActiveActionContext = (scope: number, actionUuid: string): boolean => {
    if (!mountedRef.current) return false;
    if (actionScopeRef.current !== scope) return false;
    return useDeliverStore.getState().uuid === actionUuid;
  };

  const handleDeliver = async () => {
    if (isActionPending) return;
    if (!store.uuid) {
      setIsSecretInputInvalid(false);
      return setActionError('Channel UUID is missing and cannot be delivered.');
    }
    if (profile === null) {
      setIsSecretInputInvalid(false);
      return setActionError('Channel authentication mode is still loading. Please retry.');
    }
    if (secretInput.trim().length === 0) {
      setIsSecretInputInvalid(true);
      return setActionError('Secret payload is required before delivery.');
    }
    const needsChannelPassword = requiresChannelPassword(store.adminMode);
    if (needsChannelPassword) {
      const passwordError = getChannelPasswordValidationError(softkeyPassphrase);
      if (passwordError) {
        setIsSecretInputInvalid(false);
        return setActionError(passwordError);
      }
    }

    setIsSecretInputInvalid(false);
    setActionError(null);
    setIsActionPending(true);
    const actionScope = actionScopeRef.current ?? 0;
    const actionUuid = store.uuid;

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.deliverSecret>>;
    try {
      result = await cryptoOrchestrator.deliverSecret({
        uuid: actionUuid,
        profile,
        plaintext: secretInput,
        ...(needsChannelPassword ? { softkeyPassphrase } : {}),
        ...(wrappedPrivateKey !== undefined ? { wrappedPrivateKey } : {}),
      });
    } catch {
      if (!isActiveActionContext(actionScope, actionUuid)) return;
      setIsActionPending(false);
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError('INTERNAL_ERROR'));
    }

    if (!isActiveActionContext(actionScope, actionUuid)) {
      if (result.ok) {
        setSecretInput('');
        setSoftkeyPassphrase('');
      }
      return;
    }
    setIsActionPending(false);
    if (!result.ok) {
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError(result.error.code));
    }

    store.setShowDestroyConfirm(false);
    setIsSecretInputInvalid(false);
    setActionError(null);
    setSecretInput('');
    setSoftkeyPassphrase('');
    toast.success(t('manage.deliveredToast'));
  };

  return { handleDeliver, isActiveActionContext };
}

export function useManageDestructionLogic(
  _mountedRef: RefObject<boolean>,
  actionScopeRef: RefObject<number>,
  isActionPending: boolean,
  setIsActionPending: (pending: boolean) => void,
  setActionError: (error: string | null) => void,
  setIsSecretInputInvalid: (invalid: boolean) => void,
  setSecretInput: (value: string) => void,
  setSoftkeyPassphrase: (value: string) => void,
  softkeyPassphrase: string,
  profile: SecurityProfile | null,
  isActiveActionContext: (scope: number, actionUuid: string) => boolean,
  wrappedPrivateKey: WrappedPrivateKey | undefined
) {
  const store = useDeliverStore();

  const handleDestroyConfirm = () => {
    if (isActionPending) return;
    if (profile === null) return;
    if (
      store.channelState === CHANNEL_STATE.DELETED ||
      store.channelState === CHANNEL_STATE.EXPIRED
    )
      return;
    store.setShowDestroyConfirm(true);
  };

  const handleApplyDestroy = async () => {
    if (isActionPending) return;
    if (!store.uuid) {
      setIsSecretInputInvalid(false);
      return setActionError('Channel UUID is missing and cannot be deleted.');
    }
    if (profile === null) {
      setIsSecretInputInvalid(false);
      return setActionError('Channel authentication mode is still loading. Please retry.');
    }
    const needsChannelPassword = requiresChannelPassword(store.adminMode);
    if (needsChannelPassword) {
      const passwordError = getChannelPasswordValidationError(softkeyPassphrase);
      if (passwordError) {
        setIsSecretInputInvalid(false);
        return setActionError(passwordError);
      }
    }

    setIsSecretInputInvalid(false);
    setActionError(null);
    setIsActionPending(true);
    const actionScope = actionScopeRef.current ?? 0;
    const actionUuid = store.uuid;

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.deleteChannel>>;
    try {
      result = await cryptoOrchestrator.deleteChannel({
        uuid: actionUuid,
        profile,
        ...(needsChannelPassword ? { softkeyPassphrase } : {}),
        ...(wrappedPrivateKey !== undefined ? { wrappedPrivateKey } : {}),
      });
    } catch {
      if (!isActiveActionContext(actionScope, actionUuid)) return;
      setIsActionPending(false);
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError('INTERNAL_ERROR'));
    }

    if (!isActiveActionContext(actionScope, actionUuid)) return;
    setIsActionPending(false);
    if (!result.ok) {
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError(result.error.code));
    }
    setIsSecretInputInvalid(false);
    setActionError(null);
    setSecretInput('');
    setSoftkeyPassphrase('');
  };

  return { handleDestroyConfirm, handleApplyDestroy };
}
