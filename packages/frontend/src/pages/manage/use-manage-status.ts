import { CHANNEL_STATE, ErrorResponseSchema, PublicStatusResponseSchema } from '@zerolink/shared';
import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import { useDeliverStore } from '../../stores/deliver-store';
import { isTerminalPublicState } from './manage-utils';

export function usePublicStatusFetcher(uuid: string | undefined, mountedRef: RefObject<boolean>) {
  const store = useDeliverStore();
  const [publicStatusError, setPublicStatusError] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [statusConfirmed, setStatusConfirmed] = useState(false);

  useEffect(() => {
    let canceled = false;
    if (!uuid) {
      store.setChannelState(CHANNEL_STATE.WAITING);
      setPublicStatusError(null);
      setIsUnavailable(false);
      setStatusConfirmed(false);
      return;
    }

    setIsUnavailable(false);
    setStatusConfirmed(false);
    const loadPublicStatus = async () => {
      try {
        const response = await fetch(`/api/public/${uuid}`);
        const payload = (await response.json()) as unknown;
        const parsedError = ErrorResponseSchema.safeParse(payload);
        if (
          response.status === 404 ||
          (parsedError.success && parsedError.data.code === 'NOT_FOUND')
        ) {
          if (canceled || !mountedRef.current) return;
          store.setDestroyStage('idle');
          store.setAdminMode(null);
          store.setSecurityProfile(null);
          store.setReceiverPubFpr(null);
          store.setChannelState(CHANNEL_STATE.WAITING);
          setPublicStatusError(null);
          setIsUnavailable(true);
          setStatusConfirmed(true);
          return;
        }

        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const parsedPayload = PublicStatusResponseSchema.safeParse(payload);
        if (!parsedPayload.success) throw new Error('INVALID_RESPONSE');

        if (canceled || !mountedRef.current) return;
        if (isTerminalPublicState(parsedPayload.data.state)) {
          store.setDestroyStage('idle');
          store.setAdminMode(null);
          store.setSecurityProfile(null);
          store.setReceiverPubFpr(null);
          store.setChannelState(CHANNEL_STATE.WAITING);
          setPublicStatusError(null);
          setIsUnavailable(true);
          setStatusConfirmed(true);
          return;
        }

        setPublicStatusError(null);
        setIsUnavailable(false);
        setStatusConfirmed(true);
        store.setDestroyStage('idle');
        store.setChannelState(parsedPayload.data.state);
        store.setAdminMode(parsedPayload.data.adminMode);
        store.setSecurityProfile(parsedPayload.data.securityProfile);
        store.setReceiverPubFpr(parsedPayload.data.receiverPubFpr ?? null);
      } catch (error: unknown) {
        // biome-ignore lint/suspicious/noConsole: runtime error logging for unexpected public status load failures
        console.error('[usePublicStatusFetcher] loadPublicStatus failed', { uuid, error });
        if (canceled || !mountedRef.current) return;
        store.setDestroyStage('idle');
        store.setAdminMode(null);
        store.setSecurityProfile(null);
        store.setReceiverPubFpr(null);
        store.setChannelState(CHANNEL_STATE.WAITING);
        setIsUnavailable(false);
        setStatusConfirmed(false);
        setPublicStatusError('Unable to load channel state right now. Showing safe default state.');
      }
    };

    void loadPublicStatus();
    return () => {
      canceled = true;
    };
  }, [
    uuid,
    store.setAdminMode,
    store.setSecurityProfile,
    store.setChannelState,
    store.setReceiverPubFpr,
    store.setDestroyStage,
    mountedRef,
  ]);

  return {
    isUnavailable,
    publicStatusError,
    statusConfirmed,
    setPublicStatusError,
    setIsUnavailable,
    setStatusConfirmed,
  };
}
