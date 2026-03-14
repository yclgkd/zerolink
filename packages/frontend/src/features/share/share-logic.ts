import {
  type Base64Url,
  CHANNEL_STATE,
  type ChannelState,
  ErrorResponseSchema,
  type HexString,
  PublicStatusResponseSchema,
  type SafetyCodeDisplay,
  UUIDSchema,
} from '@zerolink/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cryptoOrchestrator } from '../../crypto/orchestrator';
import { extractLockSecretFromHash } from '../../crypto/protocol-utils';
import { deriveSafetyCodeDisplay } from '../../crypto/safety-code-derive';
import type { ReceiverKeyStorage } from '../../crypto/storage';
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

export type ReceiverSafetyCodeStatus =
  | 'not-applicable'
  | 'checking-local-key'
  | 'verified-local-key'
  | 'missing-local-key'
  | 'missing-receiver-fingerprint'
  | 'mismatched-local-key'
  | 'storage-error';

export interface ReceiverSafetyCodeState {
  display: SafetyCodeDisplay | null;
  status: ReceiverSafetyCodeStatus;
  canDecryptLocally: boolean;
}

const LOCK_SECRET_SESSION_STORAGE_PREFIX = 'zerolink:share-lock-secret:';

function getLockSecretSessionStorageKey(uuid: string): string {
  return `${LOCK_SECRET_SESSION_STORAGE_PREFIX}${uuid}`;
}

function readStoredLockSecret(uuid: string): Base64Url | null {
  try {
    const value = window.sessionStorage.getItem(getLockSecretSessionStorageKey(uuid));
    if (!value) return null;
    return extractLockSecretFromHash(`#k=${value}`);
  } catch {
    return null;
  }
}

function persistLockSecret(uuid: string, lockSecretB64u: Base64Url): boolean {
  try {
    window.sessionStorage.setItem(getLockSecretSessionStorageKey(uuid), lockSecretB64u);
    return true;
  } catch (error: unknown) {
    // biome-ignore lint/suspicious/noConsole: runtime error logging for debugging share-link fragment persistence failures
    console.error('[useSharePageLockLogic] Failed to persist lock secret to sessionStorage', {
      uuid,
      error,
    });
    return false;
  }
}

function clearStoredLockSecret(uuid: string, source: string): void {
  try {
    window.sessionStorage.removeItem(getLockSecretSessionStorageKey(uuid));
  } catch (error: unknown) {
    // biome-ignore lint/suspicious/noConsole: runtime error logging for debugging share-link fragment cleanup failures
    console.error('[useSharePageLockLogic] Failed to clear lock secret from sessionStorage', {
      uuid,
      source,
      error,
    });
  }
}

function cleanupReceiverKeyBestEffort(
  receiverKeyStorage: ReceiverKeyStorage,
  uuid: string,
  source: string
): void {
  void receiverKeyStorage.remove(uuid).catch((error: unknown) => {
    // biome-ignore lint/suspicious/noConsole: runtime error logging for debugging terminal cleanup failures
    console.error('[usePublicShareState] Failed to clean up receiver key after terminal state', {
      uuid,
      source,
      error,
    });
  });
}

export function usePublicShareState(
  uuid: string | undefined,
  receiverKeyStorage: ReceiverKeyStorage
) {
  const [channelState, setChannelState] = useState<ChannelState>(CHANNEL_STATE.WAITING);
  const [receiverPubFpr, setReceiverPubFpr] = useState<HexString | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isPublicStatusLoading, setIsPublicStatusLoading] = useState(() => Boolean(uuid));
  const [publicStatusError, setPublicStatusError] = useState<string | null>(null);
  const markTerminalUnavailable = useCallback(
    (currentUuid: string, source: string) => {
      setChannelState(CHANNEL_STATE.WAITING);
      setReceiverPubFpr(null);
      setIsUnavailable(true);
      setIsPublicStatusLoading(false);
      setPublicStatusError(null);
      cleanupReceiverKeyBestEffort(receiverKeyStorage, currentUuid, source);
    },
    [receiverKeyStorage]
  );

  useEffect(() => {
    if (!uuid) {
      setChannelState(CHANNEL_STATE.WAITING);
      setReceiverPubFpr(null);
      setIsUnavailable(false);
      setIsPublicStatusLoading(false);
      setPublicStatusError(null);
      return;
    }

    const currentUuid = uuid;
    setChannelState(CHANNEL_STATE.WAITING);
    setReceiverPubFpr(null);
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
          markTerminalUnavailable(currentUuid, 'public-status:not-found');
          return;
        }

        if (!response.ok) {
          setChannelState(CHANNEL_STATE.WAITING);
          setReceiverPubFpr(null);
          setIsUnavailable(false);
          setIsPublicStatusLoading(false);
          setPublicStatusError(
            'Unable to load channel state right now. Showing safe default state.'
          );
          return;
        }

        if (!parsedPayload.success) {
          setChannelState(CHANNEL_STATE.WAITING);
          setReceiverPubFpr(null);
          setIsUnavailable(false);
          setIsPublicStatusLoading(false);
          setPublicStatusError(
            'Unable to load channel state right now. Showing safe default state.'
          );
          return;
        }

        if (isTerminalPublicState(parsedPayload.data.state)) {
          markTerminalUnavailable(currentUuid, `public-status:${parsedPayload.data.state}`);
          return;
        }

        setChannelState(parsedPayload.data.state);
        setReceiverPubFpr(parsedPayload.data.receiverPubFpr ?? null);
        setIsUnavailable(false);
        setIsPublicStatusLoading(false);
        setPublicStatusError(null);
      } catch (error: unknown) {
        if (!cancelled) {
          // biome-ignore lint/suspicious/noConsole: runtime error logging for debugging channel load failures
          console.error('[usePublicShareState] Failed to load channel state', {
            uuid: currentUuid,
            error,
          });
          setChannelState(CHANNEL_STATE.WAITING);
          setReceiverPubFpr(null);
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
  }, [markTerminalUnavailable, uuid]);

  // Real-time sync: auto-update when sender delivers or channel state changes
  useChannelSync(uuid, {
    onStateChange: useCallback(
      (update) => {
        if (isTerminalPublicState(update.state)) {
          if (uuid) {
            markTerminalUnavailable(uuid, `realtime-state:${update.state}`);
          }
          return;
        }
        setChannelState(update.state);
        setReceiverPubFpr(update.receiverPubFpr ?? null);
        setIsUnavailable(false);
        setIsPublicStatusLoading(false);
        setPublicStatusError(null);
      },
      [markTerminalUnavailable, uuid]
    ),
    onChannelClosed: useCallback(
      (reason: ChannelClosedReason) => {
        if (uuid) {
          markTerminalUnavailable(uuid, `realtime-close:${reason}`);
          return;
        }
        setChannelState(CHANNEL_STATE.WAITING);
        setReceiverPubFpr(null);
        setIsUnavailable(true);
        setIsPublicStatusLoading(false);
        setPublicStatusError(null);
      },
      [markTerminalUnavailable, uuid]
    ),
  });

  return {
    channelState,
    receiverPubFpr,
    isUnavailable,
    isPublicStatusLoading,
    publicStatusError,
  };
}

export function useSharePageLockLogic(
  uuid?: string,
  pathname: string = '',
  search: string = '',
  hash?: string
) {
  const store = useLockStore();
  const [lockError, setLockError] = useState<string | null>(null);
  const [isLockPassphraseInvalid, setIsLockPassphraseInvalid] = useState(false);
  const [isLockSubmitting, setIsLockSubmitting] = useState(false);
  const [lockSecretB64u, setLockSecretB64u] = useState<Base64Url | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const lockSecretWarning = lockSecretB64u
    ? null
    : 'This share link is missing a lock secret fragment (#k=...).';

  const clearLockSecretCache = useCallback(
    (source: string) => {
      if (!uuid) {
        setLockSecretB64u(null);
        return;
      }
      clearStoredLockSecret(uuid, source);
      setLockSecretB64u(null);
    },
    [uuid]
  );

  useEffect(() => {
    if (!uuid) {
      useLockStore.getState().setLockUuid(null);
      setLockSecretB64u(null);
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
    if (!uuid) {
      setLockSecretB64u(null);
      return;
    }

    const hashLockSecret = extractLockSecretFromHash(hash ?? '');
    if (hashLockSecret) {
      setLockSecretB64u(hashLockSecret);
      const persisted = persistLockSecret(uuid, hashLockSecret);
      if (persisted) {
        window.history.replaceState(window.history.state, '', `${pathname}${search}`);
      }
      return;
    }

    setLockSecretB64u(readStoredLockSecret(uuid));
  }, [uuid, pathname, search, hash]);

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
    clearLockSecretCache('lock-success');
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
    clearLockSecretCache,
    handlePassphraseChange,
    handleGenerate,
  };
}

export function useReceiverSafetyCodeState({
  uuid,
  channelState,
  publicReceiverPubFpr,
  localSafetyCode,
  receiverKeyStorage,
}: {
  uuid: string | undefined;
  channelState: ChannelState;
  publicReceiverPubFpr: HexString | null;
  localSafetyCode: SafetyCodeDisplay | null;
  receiverKeyStorage: ReceiverKeyStorage;
}): ReceiverSafetyCodeState {
  const [storedReceiverPubFpr, setStoredReceiverPubFpr] = useState<HexString | null>(null);
  const [isCheckingLocalKey, setIsCheckingLocalKey] = useState(false);
  const [hasStorageError, setHasStorageError] = useState(false);

  const isReceiverVerificationState =
    channelState === CHANNEL_STATE.LOCKED || channelState === CHANNEL_STATE.DELIVERED;

  useEffect(() => {
    if (!uuid || !isReceiverVerificationState) {
      setStoredReceiverPubFpr(null);
      setIsCheckingLocalKey(false);
      setHasStorageError(false);
      return;
    }

    if (localSafetyCode?.fullFpr) {
      setStoredReceiverPubFpr(localSafetyCode.fullFpr);
      setIsCheckingLocalKey(false);
      setHasStorageError(false);
      return;
    }

    let cancelled = false;
    setStoredReceiverPubFpr(null);
    setIsCheckingLocalKey(true);
    setHasStorageError(false);

    void receiverKeyStorage
      .load(uuid)
      .then((envelope) => {
        if (cancelled) return;
        setStoredReceiverPubFpr((envelope?.receiverPubFpr ?? null) as HexString | null);
        setIsCheckingLocalKey(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // biome-ignore lint/suspicious/noConsole: runtime error logging for debugging IndexedDB failures
        console.error('[useReceiverSafetyCodeState] IndexedDB load failed', { uuid, error });
        setStoredReceiverPubFpr(null);
        setIsCheckingLocalKey(false);
        setHasStorageError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [uuid, isReceiverVerificationState, localSafetyCode?.fullFpr, receiverKeyStorage]);

  if (!isReceiverVerificationState) {
    return {
      display: localSafetyCode,
      status: localSafetyCode ? 'verified-local-key' : 'not-applicable',
      canDecryptLocally: Boolean(localSafetyCode),
    };
  }

  const localReceiverPubFpr = localSafetyCode?.fullFpr ?? storedReceiverPubFpr;
  const hasLocalReceiverKey = Boolean(localReceiverPubFpr);

  if (hasStorageError) {
    return { display: null, status: 'storage-error', canDecryptLocally: false };
  }

  // Skip checking state when in-memory localSafetyCode already provides the fingerprint
  // (same-session lock), so the UI never flashes a "checking…" notice unnecessarily.
  if (isCheckingLocalKey && !hasLocalReceiverKey) {
    return { display: null, status: 'checking-local-key', canDecryptLocally: false };
  }

  if (!hasLocalReceiverKey) {
    return { display: null, status: 'missing-local-key', canDecryptLocally: false };
  }

  if (publicReceiverPubFpr && localReceiverPubFpr !== publicReceiverPubFpr) {
    return { display: null, status: 'mismatched-local-key', canDecryptLocally: false };
  }

  if (!publicReceiverPubFpr) {
    return { display: null, status: 'missing-receiver-fingerprint', canDecryptLocally: true };
  }

  const verifiedLocalReceiverPubFpr = localReceiverPubFpr as HexString;

  return {
    display:
      localSafetyCode && localSafetyCode.fullFpr === verifiedLocalReceiverPubFpr
        ? localSafetyCode
        : deriveSafetyCodeDisplay(verifiedLocalReceiverPubFpr),
    status: 'verified-local-key',
    canDecryptLocally: true,
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
