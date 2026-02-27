import type { SafetyCodeDisplay } from '@zerolink/shared';
import {
  CHANNEL_STATE,
  type ChannelState,
  PublicStatusResponseSchema,
  UUIDSchema,
} from '@zerolink/shared';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  RoleBadge,
  StateNotice,
} from '../components/layout';
import { PassphraseInput } from '../components/lock/passphrase-input';
import { SafetyCode } from '../components/safety/safety-code';
import { Button } from '../components/ui/button';
import { cryptoOrchestrator } from '../crypto/orchestrator';
import { extractLockSecretFromHash } from '../crypto/protocol-utils';
import { useDecryptStore } from '../stores/decrypt-store';
import { useLockStore } from '../stores/lock-store';

const onboardingItems = [
  {
    emoji: '🔐',
    title: 'Your passphrase stays on this device',
    description: 'It never gets sent to the server or shared with the sender.',
  },
  {
    emoji: '🔑',
    title: 'It generates your key locally',
    description: "The sender can't see your passphrase or private key material.",
  },
  {
    emoji: '🔒',
    title: 'After locking, only you can unlock',
    description: 'Delivery stays encrypted for your receiver identity only.',
  },
] as const;

const nextSteps = [
  'Contact the sender through another channel.',
  'Compare Safety Code values before delivery.',
  'Keep this tab open until the sender confirms delivery.',
] as const;

function mapLockError(code: string): string {
  switch (code) {
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

function mapDecryptError(code: string): string {
  switch (code) {
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

function isLockPassphraseErrorCode(code: string): boolean {
  return code === 'PASSPHRASE_REQUIRED';
}

function isDecryptPassphraseErrorCode(code: string): boolean {
  return code === 'PASSPHRASE_REQUIRED' || code === 'CRYPTO_ERROR';
}

function SharePageHeader() {
  return (
    <PageCardHeader>
      <div className="flex items-center justify-between gap-3">
        <PageCardTitle asChild className="text-primary">
          <h2>Secure Channel</h2>
        </PageCardTitle>
        <RoleBadge party="receiver" />
      </div>
      <PageCardDescription>
        Generate your encryption key to secure this channel.
      </PageCardDescription>
    </PageCardHeader>
  );
}

function UuidDisplay({ uuid }: { uuid?: string | undefined }) {
  return (
    <p>
      UUID:{' '}
      <code
        className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono text-foreground"
        data-testid="share-uuid"
      >
        {uuid ?? '(missing uuid)'}
      </code>
    </p>
  );
}

function OnboardingStep({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="space-y-4" data-testid="share-step-onboarding">
      <h3 className="text-base font-semibold text-foreground">Lock This Channel</h3>
      <div className="space-y-3">
        {onboardingItems.map((item, index) => (
          <div
            className="rounded-xl border border-border/60 bg-card/50 p-4"
            data-testid={`share-onboarding-card-${index + 1}`}
            key={item.title}
          >
            <p className="flex items-center gap-2 text-foreground">
              <span>{item.emoji}</span>
              <span className="font-medium">{item.title}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
          </div>
        ))}
      </div>
      <Button data-testid="share-continue-button" onClick={onContinue} type="button">
        Continue to Lock
      </Button>
    </section>
  );
}

function LockStep({
  passphrase,
  canGenerate,
  lockPending,
  lockSecretWarning,
  lockError,
  isLockPassphraseInvalid,
  onPassphraseChange,
  onBack,
  onGenerate,
}: {
  passphrase: string;
  canGenerate: boolean;
  lockPending: boolean;
  lockSecretWarning: string | null;
  lockError: string | null;
  isLockPassphraseInvalid: boolean;
  onPassphraseChange: (value: string) => void;
  onBack: () => void;
  onGenerate: () => void;
}) {
  return (
    <section className="space-y-4" data-testid="share-step-lock">
      <h3 className="text-base font-semibold text-foreground">Generate Key & Lock</h3>
      <PassphraseInput
        ariaDescribedBy={lockError && isLockPassphraseInvalid ? 'share-lock-error' : undefined}
        ariaInvalid={isLockPassphraseInvalid ? true : undefined}
        inputId="share-lock-passphrase"
        label="Lock passphrase"
        onChange={onPassphraseChange}
        placeholder="Enter a strong passphrase"
        value={passphrase}
      />

      {lockSecretWarning ? (
        <StateNotice
          data-testid="share-lock-secret-warning"
          id="share-lock-secret-warning"
          tone="warning"
        >
          {lockSecretWarning}
        </StateNotice>
      ) : null}

      {lockError ? (
        <StateNotice
          autoFocusOnMount
          data-testid="share-lock-error"
          id="share-lock-error"
          tone="error"
        >
          {lockError}
        </StateNotice>
      ) : null}

      <div className="flex gap-2">
        <Button
          data-testid="share-back-button"
          disabled={lockPending}
          onClick={onBack}
          type="button"
          variant="secondary"
        >
          Back
        </Button>
        <Button
          data-testid="share-generate-button"
          disabled={!canGenerate || lockPending}
          onClick={onGenerate}
          type="button"
        >
          {lockPending ? 'Locking...' : 'Generate Key & Lock'}
        </Button>
      </div>
    </section>
  );
}

function LockedStep({ safetyCodeAvailable }: { safetyCodeAvailable: SafetyCodeDisplay | null }) {
  return (
    <section className="space-y-4" data-testid="share-step-locked">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Channel Locked Successfully</h3>
        <p className="text-xs text-muted-foreground">
          Verify the Safety Code with the sender before delivery.
        </p>
      </div>

      {safetyCodeAvailable ? (
        <SafetyCode display={safetyCodeAvailable} />
      ) : (
        <StateNotice
          data-testid="share-safety-unavailable"
          title="Safety Code unavailable on this device."
          tone="warning"
        >
          <p className="mt-1 text-xs text-neon-orange">
            Safety Code is generated locally during lock and is not recoverable from server state.
          </p>
        </StateNotice>
      )}

      <div
        className="space-y-2 rounded-xl border border-neon-cyan/35 bg-neon-cyan/10 p-4"
        data-testid="share-next-steps"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-neon-cyan">Next Steps</p>
        <ol className="space-y-1 text-sm text-foreground">
          {nextSteps.map((stepText) => (
            <li key={stepText}>{stepText}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function DecryptErrorPanel({ error }: { error: string }) {
  return (
    <StateNotice
      autoFocusOnMount
      data-testid="share-decrypt-error"
      id="share-decrypt-error"
      tone="error"
    >
      {error}
    </StateNotice>
  );
}

function DeliveredStep({
  passphrase,
  decryptPending,
  decryptError,
  isDecryptPassphraseInvalid,
  plaintext,
  burned,
  canDecrypt,
  canBurn,
  onPassphraseChange,
  onDecrypt,
  onBurn,
}: {
  passphrase: string;
  decryptPending: boolean;
  decryptError: string | null;
  isDecryptPassphraseInvalid: boolean;
  plaintext: string | null;
  burned: boolean;
  canDecrypt: boolean;
  canBurn: boolean;
  onPassphraseChange: (value: string) => void;
  onDecrypt: () => void;
  onBurn: () => void;
}) {
  return (
    <section className="space-y-4" data-testid="share-step-delivered">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Content Delivered</h3>
        <p className="text-xs text-muted-foreground">
          Enter your passphrase to decrypt content locally on this device.
        </p>
      </div>

      <div aria-busy={decryptPending} className="space-y-3" data-testid="share-decrypt-panel">
        <PassphraseInput
          ariaDescribedBy={
            decryptError && isDecryptPassphraseInvalid ? 'share-decrypt-error' : undefined
          }
          ariaInvalid={isDecryptPassphraseInvalid ? true : undefined}
          inputId="share-decrypt-passphrase"
          label="Decrypt passphrase"
          onChange={onPassphraseChange}
          placeholder="Enter passphrase to decrypt"
          value={passphrase}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="share-decrypt-button"
            disabled={!canDecrypt}
            onClick={onDecrypt}
            type="button"
          >
            {decryptPending ? 'Decrypting...' : 'Decrypt'}
          </Button>
          <Button
            data-testid="share-decrypt-burn"
            disabled={!canBurn}
            onClick={onBurn}
            type="button"
            variant="danger"
          >
            Burn Local Plaintext
          </Button>
        </div>
      </div>

      {decryptError ? <DecryptErrorPanel error={decryptError} /> : null}

      {plaintext ? (
        <div
          className="space-y-2 rounded-xl border border-neon-green/35 bg-neon-green/10 p-4"
          data-testid="share-decrypt-plaintext"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-neon-green">Plaintext</p>
          <pre className="whitespace-pre-wrap break-words text-sm text-foreground">{plaintext}</pre>
        </div>
      ) : null}

      {burned ? (
        <StateNotice
          data-testid="share-decrypt-burned"
          title="Local plaintext has been burned."
          tone="warning"
        >
          <p className="mt-1 text-xs text-neon-orange">
            Re-enter your passphrase to decrypt again if needed.
          </p>
        </StateNotice>
      ) : null}
    </section>
  );
}

function LoadingStep() {
  return (
    <StateNotice
      aria-busy="true"
      data-testid="share-step-loading"
      title="Loading Channel State"
      tone="info"
    >
      <p className="text-xs text-muted-foreground">Fetching secure channel status for this link.</p>
    </StateNotice>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled terminal state: ${String(value)}`);
}

function TerminalStep({
  state,
}: {
  state: typeof CHANNEL_STATE.DELETED | typeof CHANNEL_STATE.EXPIRED;
}) {
  switch (state) {
    case CHANNEL_STATE.DELETED:
      return (
        <section className="space-y-2" data-testid="share-step-deleted">
          <h3 className="text-base font-semibold text-foreground">Channel Deleted</h3>
          <p className="text-xs text-muted-foreground">
            This channel has been destroyed and cannot be recovered.
          </p>
        </section>
      );
    case CHANNEL_STATE.EXPIRED:
      return (
        <section className="space-y-2" data-testid="share-step-expired">
          <h3 className="text-base font-semibold text-foreground">Channel Expired</h3>
          <p className="text-xs text-muted-foreground">
            The channel exceeded its lifetime and is no longer valid for delivery.
          </p>
        </section>
      );
    default:
      return assertNever(state);
  }
}

function usePublicShareState(uuid?: string) {
  const [channelState, setChannelState] = useState<ChannelState>(CHANNEL_STATE.WAITING);
  const [isPublicStatusLoading, setIsPublicStatusLoading] = useState(() => Boolean(uuid));

  useEffect(() => {
    if (!uuid) {
      setChannelState(CHANNEL_STATE.WAITING);
      setIsPublicStatusLoading(false);
      return;
    }

    const currentUuid = uuid;
    setChannelState(CHANNEL_STATE.WAITING);
    setIsPublicStatusLoading(true);

    let cancelled = false;
    async function loadChannelState(): Promise<void> {
      try {
        const response = await fetch(`/api/public/${currentUuid}`);
        const payload = (await response.json()) as unknown;
        const parsedPayload = PublicStatusResponseSchema.safeParse(payload);
        if (cancelled) return;

        if (!parsedPayload.success) {
          setChannelState(CHANNEL_STATE.WAITING);
          setIsPublicStatusLoading(false);
          return;
        }

        setChannelState(parsedPayload.data.state);
        setIsPublicStatusLoading(false);
      } catch {
        if (!cancelled) {
          setChannelState(CHANNEL_STATE.WAITING);
          setIsPublicStatusLoading(false);
        }
      }
    }

    void loadChannelState();
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  return {
    channelState,
    isPublicStatusLoading,
  };
}

function useSharePageLockLogic(uuid?: string, hash?: string) {
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

function useSharePageDecryptLogic(uuid?: string, enabled?: boolean) {
  const store = useDecryptStore();
  const [passphrase, setPassphrase] = useState('');
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [isDecryptPassphraseInvalid, setIsDecryptPassphraseInvalid] = useState(false);
  const [isDecryptSubmitting, setIsDecryptSubmitting] = useState(false);
  const mountedRef = useRef(true);
  const decryptActionScopeRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    decryptActionScopeRef.current += 1;
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
    setIsDecryptSubmitting(false);
    setPassphrase('');
    setDecryptError(null);
    setIsDecryptPassphraseInvalid(false);
    useDecryptStore.getState().setPlaintext(null);
  }, [enabled]);

  const canDecrypt =
    Boolean(enabled) && Boolean(store.uuid) && passphrase.trim().length > 0 && !isDecryptSubmitting;

  const canBurn = Boolean(enabled) && Boolean(store.plaintext) && !isDecryptSubmitting;

  useEffect(() => {
    // If plaintext is present, decrypt has already completed and pending must settle.
    if (store.plaintext && isDecryptSubmitting) {
      setIsDecryptSubmitting(false);
    }
  }, [store.plaintext, isDecryptSubmitting]);

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

  async function handleDecrypt(): Promise<void> {
    if (!enabled || isDecryptSubmitting) return;

    if (!store.uuid) return setDecryptErrorFromCode('INVALID_REQUEST');
    if (passphrase.trim().length === 0) return setDecryptErrorFromCode('PASSPHRASE_REQUIRED');

    const actionScope = decryptActionScopeRef.current;
    const actionUuid = store.uuid;

    clearDecryptError();
    setIsDecryptSubmitting(true);

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.decryptDelivered>>;
    try {
      result = await cryptoOrchestrator.decryptDelivered({
        uuid: actionUuid,
        passphrase,
      });
    } catch {
      if (!isActiveDecryptContext(actionScope, actionUuid)) {
        if (mountedRef.current) {
          setIsDecryptSubmitting(false);
        }
        return;
      }
      setIsDecryptSubmitting(false);
      setDecryptErrorFromCode('INTERNAL_ERROR');
      return;
    }

    if (!isActiveDecryptContext(actionScope, actionUuid)) {
      if (mountedRef.current) {
        setIsDecryptSubmitting(false);
      }
      return;
    }
    setIsDecryptSubmitting(false);
    if (!result.ok) {
      setDecryptErrorFromCode(result.error.code);
      return;
    }

    clearDecryptError();
  }

  function handleBurn(): void {
    if (!enabled || isDecryptSubmitting || !store.plaintext) return;

    store.markBurned();
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

/**
 * Receiver page integrating lock flow and delivered decryption flow with orchestrator.
 */
export function SharePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();
  const location = useLocation();
  const publicState = usePublicShareState(uuid);
  const lockLogic = useSharePageLockLogic(uuid, location.hash);
  const isDeliveredState =
    !publicState.isPublicStatusLoading && publicState.channelState === CHANNEL_STATE.DELIVERED;
  const decryptLogic = useSharePageDecryptLogic(uuid, isDeliveredState);
  const isPageBusy =
    publicState.isPublicStatusLoading || lockLogic.lockPending || decryptLogic.decryptPending;

  return (
    <PageCard data-testid="page-share" tone="cyan">
      <SharePageHeader />
      <PageCardContent aria-busy={isPageBusy} className="space-y-6">
        <UuidDisplay uuid={uuid} />

        {publicState.isPublicStatusLoading ? <LoadingStep /> : null}

        {!publicState.isPublicStatusLoading &&
        publicState.channelState === CHANNEL_STATE.WAITING ? (
          <>
            {lockLogic.store.step === 'onboarding' ? (
              <OnboardingStep onContinue={() => lockLogic.store.setStep('lock')} />
            ) : null}
            {lockLogic.store.step === 'lock' ? (
              <LockStep
                canGenerate={lockLogic.canGenerate}
                isLockPassphraseInvalid={lockLogic.isLockPassphraseInvalid}
                lockError={lockLogic.lockError}
                lockPending={lockLogic.lockPending}
                lockSecretWarning={lockLogic.lockSecretWarning}
                onBack={() => {
                  if (lockLogic.lockPending) return;
                  lockLogic.clearLockError();
                  lockLogic.store.setStep('onboarding');
                }}
                onGenerate={() => void lockLogic.handleGenerate()}
                onPassphraseChange={lockLogic.handlePassphraseChange}
                passphrase={lockLogic.store.passphrase}
              />
            ) : null}
            {lockLogic.store.step === 'locked' ? (
              <LockedStep safetyCodeAvailable={lockLogic.store.safetyCode} />
            ) : null}
          </>
        ) : null}

        {!publicState.isPublicStatusLoading && publicState.channelState === CHANNEL_STATE.LOCKED ? (
          <LockedStep safetyCodeAvailable={lockLogic.store.safetyCode} />
        ) : null}

        {isDeliveredState ? (
          <DeliveredStep
            burned={decryptLogic.store.burned}
            canBurn={decryptLogic.canBurn}
            canDecrypt={decryptLogic.canDecrypt}
            decryptError={decryptLogic.decryptError}
            isDecryptPassphraseInvalid={decryptLogic.isDecryptPassphraseInvalid}
            decryptPending={decryptLogic.decryptPending}
            onBurn={decryptLogic.handleBurn}
            onDecrypt={() => void decryptLogic.handleDecrypt()}
            onPassphraseChange={decryptLogic.handlePassphraseChange}
            passphrase={decryptLogic.passphrase}
            plaintext={decryptLogic.store.plaintext}
          />
        ) : null}

        {!publicState.isPublicStatusLoading &&
        publicState.channelState === CHANNEL_STATE.DELETED ? (
          <TerminalStep state={CHANNEL_STATE.DELETED} />
        ) : null}

        {!publicState.isPublicStatusLoading &&
        publicState.channelState === CHANNEL_STATE.EXPIRED ? (
          <TerminalStep state={CHANNEL_STATE.EXPIRED} />
        ) : null}
      </PageCardContent>
    </PageCard>
  );
}
