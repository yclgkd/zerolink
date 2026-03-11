import {
  CHANNEL_STATE,
  type ChannelState,
  ErrorResponseSchema,
  PublicStatusResponseSchema,
  UUIDSchema,
} from '@zerolink/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cryptoOrchestrator } from '../../crypto/orchestrator';
import { extractLockSecretFromHash } from '../../crypto/protocol-utils';
import { useDecryptStore } from '../../stores/decrypt-store';
import { useLockStore } from '../../stores/lock-store';
import type { ChannelClosedReason } from '../../sync/channel-sync.ts';
import { useChannelSync } from '../../sync/use-channel-sync.ts';

export function mapLockError(code: string): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'This channel is no longer available.';
    case 'INVALID_LOCK_SECRET':
      return 'This share link is missing or has an invalid lock secret (#k=...).';
    case 'PASSPHRASE_REQUIRED':
      return 'Passphrase is required before locking.';
    case 'MISSING_LOCK_CHALLENGE':
      return 'Unable to fetch lock challenge. Please retry.';
    case 'KEY_STORAGE_ERROR':
      return 'Unable to store receiver key material on this device.';
    case 'CRYPTO_ERROR':
    case 'INTERNAL_ERROR':
      return 'An unexpected error occurred. Please try again.';
    case 'NETWORK_ERROR':
    case 'BAD_REQUEST':
    case 'INVALID_REQUEST':
      return 'Lock request failed due to network or request validation.';
    default:
      return 'Lock failed. Please try again.';
  }
}

export function mapDecryptError(code: string): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'This channel is no longer available.';
    case 'PASSPHRASE_REQUIRED':
      return 'Passphrase is required to decrypt.';
    case 'CHANNEL_NOT_DELIVERED':
      return 'Channel is not delivered yet. Ask sender to deliver first.';
    case 'KEY_STORAGE_ERROR':
      return 'Local key material is unavailable on this device.';
    case 'INTEGRITY_MISMATCH':
      return 'Ciphertext integrity verification failed.';
    case 'CRYPTO_ERROR':
      return 'Unable to decrypt with the provided passphrase.';
    case 'NETWORK_ERROR':
    case 'BAD_REQUEST':
    case 'INVALID_REQUEST':
      return 'Decrypt request failed due to network or request validation.';
    case 'INTERNAL_ERROR':
      return 'An unexpected error occurred. Please try again.';
    default:
      return 'Decrypt failed. Please try again.';
  }
}

export function isLockPassphraseErrorCode(code: string): boolean {
  return code === 'PASSPHRASE_REQUIRED';
}

export function isDecryptPassphraseErrorCode(code: string): boolean {
  return code === 'PASSPHRASE_REQUIRED' || code === 'CRYPTO_ERROR';
}

function isTerminalPublicState(state: ChannelState): boolean {
  return state === CHANNEL_STATE.DELETED || state === CHANNEL_STATE.EXPIRED;
}

export function usePublicShareState(uuid?: string) {
  const [channelState, setChannelState] = useState<ChannelState>(CHANNEL_STATE.WAITING);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isPublicStatusLoading, setIsPublicStatusLoading] = useState(() => Boolean(uuid));
  const [publicStatusError, setPublicStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid) {
      setChannelState(CHANNEL_STATE.WAITING);
      setIsUnavailable(false);
      setIsPublicStatusLoading(false);
      setPublicStatusError(null);
      return;
    }

    const currentUuid = uuid;
    setChannelState(CHANNEL_STATE.WAITING);
    setIsUnavailable(false);
    setIsPublicStatusLoading(true);
    setPublicStatusError(null);

    let cancelled = false;
    async function loadChannelState(): Promise<void> {
      try {
        const response = await fetch(`/api/public/${currentUuid}`);
        const payload = (await response.json()) as unknown;
        const parsedError = ErrorResponseSchema.safeParse(payload);
        const parsedPayload = PublicStatusResponseSchema.safeParse(payload);
        if (cancelled) return;

        if (
          response.status === 404 ||
          (parsedError.success && parsedError.data.code === 'NOT_FOUND')
        ) {
          setChannelState(CHANNEL_STATE.WAITING);
          setIsUnavailable(true);
          setIsPublicStatusLoading(false);
          setPublicStatusError(null);
          return;
        }

        if (!response.ok) {
          setChannelState(CHANNEL_STATE.WAITING);
          setIsUnavailable(false);
          setIsPublicStatusLoading(false);
          setPublicStatusError(
            'Unable to load channel state right now. Showing safe default state.'
          );
          return;
        }

        if (!parsedPayload.success) {
          setChannelState(CHANNEL_STATE.WAITING);
          setIsUnavailable(false);
          setIsPublicStatusLoading(false);
          setPublicStatusError(
            'Unable to load channel state right now. Showing safe default state.'
          );
          return;
        }

        if (isTerminalPublicState(parsedPayload.data.state)) {
          setChannelState(CHANNEL_STATE.WAITING);
          setIsUnavailable(true);
          setIsPublicStatusLoading(false);
          setPublicStatusError(null);
          return;
        }

        setChannelState(parsedPayload.data.state);
        setIsUnavailable(false);
        setIsPublicStatusLoading(false);
        setPublicStatusError(null);
      } catch {
        if (!cancelled) {
          setChannelState(CHANNEL_STATE.WAITING);
          setIsUnavailable(false);
          setIsPublicStatusLoading(false);
          setPublicStatusError(
            'Unable to load channel state right now. Showing safe default state.'
          );
        }
      }
    }

    void loadChannelState();
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  // Real-time sync: auto-update when sender delivers or channel state changes
  useChannelSync(uuid, {
    onStateChange: useCallback((update) => {
      if (isTerminalPublicState(update.state)) {
        setChannelState(CHANNEL_STATE.WAITING);
        setIsUnavailable(true);
        return;
      }
      setChannelState(update.state);
      setIsUnavailable(false);
      setIsPublicStatusLoading(false);
      setPublicStatusError(null);
    }, []),
    onChannelClosed: useCallback((_reason: ChannelClosedReason) => {
      setChannelState(CHANNEL_STATE.WAITING);
      setIsUnavailable(true);
      setIsPublicStatusLoading(false);
      setPublicStatusError(null);
    }, []),
  });

  return {
    channelState,
    isUnavailable,
    isPublicStatusLoading,
    publicStatusError,
  };
}

export function useSharePageLockLogic(uuid?: string, hash?: string) {
  const store = useLockStore();
  const [lockError, setLockError] = useState<string | null>(null);
  const [isLockPassphraseInvalid, setIsLockPassphraseInvalid] = useState(false);
  const [isLockSubmitting, setIsLockSubmitting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const lockSecretB64u = extractLockSecretFromHash(hash ?? '');
  const lockSecretWarning = lockSecretB64u
    ? null
    : 'This share link is missing a lock secret fragment (#k=...).';

  useEffect(() => {
    if (!uuid) {
      useLockStore.getState().setLockUuid(null);
      setLockError(null);
      setIsLockPassphraseInvalid(false);
      return;
    }
    const parsedUuid = UUIDSchema.safeParse(uuid);
    useLockStore.getState().setLockUuid(parsedUuid.success ? parsedUuid.data : null);
    setLockError(null);
    setIsLockPassphraseInvalid(false);
  }, [uuid]);

  useEffect(() => {
    return () => useLockStore.getState().resetLockStore();
  }, []);

  const lockPending = isLockSubmitting;
  const canGenerate =
    Boolean(store.uuid) &&
    store.passphrase.trim().length > 0 &&
    Boolean(lockSecretB64u) &&
    !lockPending;

  function clearLockError(): void {
    setLockError(null);
    setIsLockPassphraseInvalid(false);
  }

  function setLockErrorFromCode(code: string): void {
    setLockError(mapLockError(code));
    setIsLockPassphraseInvalid(isLockPassphraseErrorCode(code));
  }

  function handlePassphraseChange(value: string): void {
    store.setPassphrase(value);
    if (lockError || isLockPassphraseInvalid) {
      clearLockError();
    }
  }

  async function handleGenerate(): Promise<void> {
    if (lockPending) return;

    if (!store.uuid) return setLockErrorFromCode('INVALID_REQUEST');
    if (!lockSecretB64u) return setLockErrorFromCode('INVALID_LOCK_SECRET');
    if (store.passphrase.trim().length === 0) return setLockErrorFromCode('PASSPHRASE_REQUIRED');

    clearLockError();
    setIsLockSubmitting(true);

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.lockChannel>>;
    try {
      result = await cryptoOrchestrator.lockChannel({
        uuid: store.uuid,
        lockSecretB64u,
        passphrase: store.passphrase,
      });
    } catch {
      if (!mountedRef.current) return;
      setIsLockSubmitting(false);
      setLockErrorFromCode('INTERNAL_ERROR');
      return;
    }

    if (!mountedRef.current) return;
    setIsLockSubmitting(false);
    if (!result.ok) return setLockErrorFromCode(result.error.code);
    clearLockError();
  }

  return {
    store,
    lockError,
    isLockPassphraseInvalid,
    clearLockError,
    lockPending,
    canGenerate,
    lockSecretWarning,
    handlePassphraseChange,
    handleGenerate,
  };
}

export function useSharePageDecryptLogic(uuid?: string, enabled?: boolean) {
  const store = useDecryptStore();
  const [passphrase, setPassphrase] = useState('');
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [isDecryptPassphraseInvalid, setIsDecryptPassphraseInvalid] = useState(false);
  const [isDecryptSubmitting, setIsDecryptSubmitting] = useState(false);
  const mountedRef = useRef(true);
  const decryptActionScopeRef = useRef(0);
  const decryptRequestIdRef = useRef(0);
  const decryptInFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    decryptActionScopeRef.current += 1;
    decryptInFlightRef.current = false;
    setIsDecryptSubmitting(false);

    if (!uuid) {
      useDecryptStore.getState().setDecryptUuid(null);
      setPassphrase('');
      setDecryptError(null);
      setIsDecryptPassphraseInvalid(false);
      return;
    }

    const parsedUuid = UUIDSchema.safeParse(uuid);
    useDecryptStore.getState().setDecryptUuid(parsedUuid.success ? parsedUuid.data : null);
    setPassphrase('');
    setDecryptError(null);
    setIsDecryptPassphraseInvalid(false);
  }, [uuid]);

  useEffect(() => {
    return () => useDecryptStore.getState().resetDecryptStore();
  }, []);

  useEffect(() => {
    if (enabled) return;

    decryptActionScopeRef.current += 1;
    decryptInFlightRef.current = false;
    setIsDecryptSubmitting(false);
    setPassphrase('');
    setDecryptError(null);
    setIsDecryptPassphraseInvalid(false);
    useDecryptStore.getState().setPlaintext(null);
  }, [enabled]);

  const canDecrypt =
    Boolean(enabled) && Boolean(store.uuid) && passphrase.trim().length > 0 && !isDecryptSubmitting;

  const canBurn = Boolean(enabled) && Boolean(store.plaintext) && !isDecryptSubmitting;

  function isActiveDecryptContext(scope: number, actionUuid: string): boolean {
    if (!mountedRef.current) return false;
    if (decryptActionScopeRef.current !== scope) return false;
    return useDecryptStore.getState().uuid === actionUuid;
  }

  function clearDecryptError(): void {
    setDecryptError(null);
    setIsDecryptPassphraseInvalid(false);
  }

  function setDecryptErrorFromCode(code: string): void {
    setDecryptError(mapDecryptError(code));
    setIsDecryptPassphraseInvalid(isDecryptPassphraseErrorCode(code));
  }

  function settleDecryptSubmitting(requestId: number): void {
    if (decryptRequestIdRef.current !== requestId) return;
    decryptInFlightRef.current = false;
    setIsDecryptSubmitting(false);
  }

  async function handleDecrypt(): Promise<void> {
    if (!enabled || isDecryptSubmitting || decryptInFlightRef.current) return;

    if (!store.uuid) return setDecryptErrorFromCode('INVALID_REQUEST');
    if (passphrase.trim().length === 0) return setDecryptErrorFromCode('PASSPHRASE_REQUIRED');

    const actionScope = decryptActionScopeRef.current;
    const actionUuid = store.uuid;
    const requestId = decryptRequestIdRef.current + 1;
    decryptRequestIdRef.current = requestId;
    decryptInFlightRef.current = true;

    clearDecryptError();
    setIsDecryptSubmitting(true);

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.decryptDelivered>>;
    try {
      result = await cryptoOrchestrator.decryptDelivered({
        uuid: actionUuid,
        passphrase,
      });
    } catch {
      settleDecryptSubmitting(requestId);
      if (!isActiveDecryptContext(actionScope, actionUuid)) return;
      setDecryptErrorFromCode('INTERNAL_ERROR');
      return;
    }

    settleDecryptSubmitting(requestId);
    if (!isActiveDecryptContext(actionScope, actionUuid)) return;
    if (!result.ok) {
      setDecryptErrorFromCode(result.error.code);
      return;
    }

    clearDecryptError();
  }

  function handleBurn(): void {
    if (!enabled || isDecryptSubmitting || !store.plaintext) return;

    store.markLocalPlaintextBurned();
    setPassphrase('');
    clearDecryptError();
  }

  return {
    store,
    passphrase,
    decryptError,
    isDecryptPassphraseInvalid,
    decryptPending: isDecryptSubmitting,
    canDecrypt,
    canBurn,
    handlePassphraseChange: (value: string) => {
      setPassphrase(value);
      if (decryptError || isDecryptPassphraseInvalid) {
        clearDecryptError();
      }
    },
    handleDecrypt,
    handleBurn,
  };
}
