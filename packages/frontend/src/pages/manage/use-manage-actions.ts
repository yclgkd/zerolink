import { CHANNEL_STATE, type SecurityProfile, type WrappedPrivateKey } from '@zerolink/shared';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cryptoOrchestrator } from '../../crypto/orchestrator';
import { useDeliverStore } from '../../stores/deliver-store';
import {
  getChannelPasswordValidationErrorI18n,
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
  selectedFile: File | null,
  softkeyPassphrase: string,
  profile: SecurityProfile | null,
  getWrappedPrivateKey: () => WrappedPrivateKey | undefined,
  setSecretInput: (value: string) => void,
  setSelectedFile: (value: File | null) => void,
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
    if (secretInput.trim().length === 0 && !selectedFile) {
      setIsSecretInputInvalid(true);
      return setActionError('Secret text or a file is required before delivery.');
    }
    const needsChannelPassword = requiresChannelPassword(store.adminMode);
    if (needsChannelPassword) {
      const passErr = getChannelPasswordValidationErrorI18n(
        softkeyPassphrase,
        t('manage.softkeyLabel')
      );
      if (passErr) {
        setIsSecretInputInvalid(false);
        return setActionError(t(passErr.key, passErr.params));
      }
    }

    setIsSecretInputInvalid(false);
    setActionError(null);
    setIsActionPending(true);
    const actionScope = actionScopeRef.current ?? 0;
    const actionUuid = store.uuid;

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.deliverSecret>>;
    try {
      const wrappedPrivateKey = getWrappedPrivateKey();
      let fileInput:
        | {
            fileName: string;
            mediaType: string;
            blob?: Blob;
            size?: number;
          }
        | undefined;
      if (selectedFile) {
        fileInput = {
          fileName: selectedFile.name,
          mediaType: selectedFile.type || 'application/octet-stream',
          blob: selectedFile,
          size: selectedFile.size,
        };
      }
      result = await cryptoOrchestrator.deliverSecret({
        uuid: actionUuid,
        profile,
        plaintext: selectedFile ? '' : secretInput,
        ...(fileInput ? { file: fileInput } : {}),
        ...(needsChannelPassword ? { softkeyPassphrase } : {}),
        ...(wrappedPrivateKey !== undefined ? { wrappedPrivateKey } : {}),
      });
    } catch (error: unknown) {
      // biome-ignore lint/suspicious/noConsole: runtime error logging for unexpected deliverSecret failures
      console.error('[useManageDeliveryLogic] deliverSecret threw unexpectedly', {
        uuid: actionUuid,
        error,
      });
      if (!isActiveActionContext(actionScope, actionUuid)) return;
      setIsActionPending(false);
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError('INTERNAL_ERROR'));
    }

    if (!isActiveActionContext(actionScope, actionUuid)) {
      if (result.ok) {
        setSecretInput('');
        setSelectedFile(null);
        setSoftkeyPassphrase('');
      }
      return;
    }
    setIsActionPending(false);
    if (!result.ok) {
      setIsSecretInputInvalid(false);
      setSelectedFile(null);
      return setActionError(mapActionError(result.error.code, result.error.message));
    }

    store.setShowDestroyConfirm(false);
    setIsSecretInputInvalid(false);
    setActionError(null);
    setSecretInput('');
    setSelectedFile(null);
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
  getWrappedPrivateKey: () => WrappedPrivateKey | undefined
) {
  const { t } = useTranslation();
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
      const passErr = getChannelPasswordValidationErrorI18n(
        softkeyPassphrase,
        t('manage.softkeyLabel')
      );
      if (passErr) {
        setIsSecretInputInvalid(false);
        return setActionError(t(passErr.key, passErr.params));
      }
    }

    setIsSecretInputInvalid(false);
    setActionError(null);
    setIsActionPending(true);
    const actionScope = actionScopeRef.current ?? 0;
    const actionUuid = store.uuid;

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.deleteChannel>>;
    try {
      const wrappedPrivateKey = getWrappedPrivateKey();
      result = await cryptoOrchestrator.deleteChannel({
        uuid: actionUuid,
        profile,
        ...(needsChannelPassword ? { softkeyPassphrase } : {}),
        ...(wrappedPrivateKey !== undefined ? { wrappedPrivateKey } : {}),
      });
    } catch (error: unknown) {
      // biome-ignore lint/suspicious/noConsole: runtime error logging for unexpected deleteChannel failures
      console.error('[useManageDestructionLogic] deleteChannel threw unexpectedly', {
        uuid: actionUuid,
        error,
      });
      if (!isActiveActionContext(actionScope, actionUuid)) return;
      setIsActionPending(false);
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError('INTERNAL_ERROR'));
    }

    if (!isActiveActionContext(actionScope, actionUuid)) return;
    setIsActionPending(false);
    if (!result.ok) {
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError(result.error.code, result.error.message));
    }
    setIsSecretInputInvalid(false);
    setActionError(null);
    setSecretInput('');
    setSoftkeyPassphrase('');
  };

  return { handleDestroyConfirm, handleApplyDestroy };
}
