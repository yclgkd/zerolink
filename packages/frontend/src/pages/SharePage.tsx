import type { SafetyCodeDisplay } from '@zerolink/shared';
import {
  CHANNEL_STATE,
  type ChannelState,
  type DecryptFetchResponse,
  DecryptFetchResponseSchema,
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
} from '../components/layout';
import { PassphraseInput } from '../components/lock/passphrase-input';
import { SafetyCode } from '../components/safety/safety-code';
import { Button } from '../components/ui/button';
import { cryptoOrchestrator } from '../crypto/orchestrator';
import { extractLockSecretFromHash } from '../crypto/protocol-utils';
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

function formatDeliveredAt(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
}

function parseDecryptFetchPayload(payload: unknown): DecryptFetchResponse | null {
  const result = DecryptFetchResponseSchema.safeParse(payload);
  return result.success ? result.data : null;
}

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
  onPassphraseChange,
  onBack,
  onGenerate,
}: {
  passphrase: string;
  canGenerate: boolean;
  lockPending: boolean;
  lockSecretWarning: string | null;
  lockError: string | null;
  onPassphraseChange: (value: string) => void;
  onBack: () => void;
  onGenerate: () => void;
}) {
  return (
    <section className="space-y-4" data-testid="share-step-lock">
      <h3 className="text-base font-semibold text-foreground">Generate Key & Lock</h3>
      <PassphraseInput
        onChange={onPassphraseChange}
        placeholder="Enter a strong passphrase"
        value={passphrase}
      />

      {lockSecretWarning ? (
        <div
          className="rounded-xl border border-neon-orange/40 bg-neon-orange/10 p-3 text-xs text-neon-orange"
          data-testid="share-lock-secret-warning"
        >
          {lockSecretWarning}
        </div>
      ) : null}

      {lockError ? (
        <div
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          data-testid="share-lock-error"
        >
          {lockError}
        </div>
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
        <div
          className="rounded-xl border border-neon-orange/40 bg-neon-orange/10 p-4 text-sm"
          data-testid="share-safety-unavailable"
        >
          <p className="font-medium text-foreground">Safety Code unavailable on this device.</p>
          <p className="mt-1 text-xs text-neon-orange">
            Safety Code is generated locally during lock and is not recoverable from server state.
          </p>
        </div>
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

function DecryptFetchSummary({ payload }: { payload: DecryptFetchResponse }) {
  return (
    <div
      className="space-y-2 rounded-xl border border-neon-green/35 bg-neon-green/10 p-4"
      data-testid="share-decrypt-summary"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-neon-green">
        Encrypted Payload Retrieved
      </p>
      <p className="text-xs text-foreground">
        Delivered at: <span className="font-medium">{formatDeliveredAt(payload.deliveredAt)}</span>
      </p>
      <p className="text-xs text-foreground">
        Receiver fingerprint prefix:{' '}
        <code className="text-neon-cyan">{payload.receiverPubFpr.slice(0, 16)}</code>
      </p>
      <p className="text-xs text-foreground">
        Cipher pad block: <span className="font-medium">{payload.cipherBundle.padBlock}</span>
      </p>
    </div>
  );
}

function DecryptFetchErrorPanel({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div
      className="space-y-3 rounded-xl border border-destructive/35 bg-destructive/10 p-4"
      data-testid="share-decrypt-error"
    >
      <p className="text-xs text-destructive">{error}</p>
      <Button
        data-testid="share-decrypt-retry"
        onClick={onRetry}
        size="sm"
        type="button"
        variant="secondary"
      >
        Retry
      </Button>
    </div>
  );
}

function DeliveredStep({
  decryptFetchPayload,
  decryptFetchError,
  onRetry,
}: {
  decryptFetchPayload: DecryptFetchResponse | null;
  decryptFetchError: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="space-y-4" data-testid="share-step-delivered">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Content Delivered</h3>
        <p className="text-xs text-muted-foreground">
          Sender has delivered encrypted content. Decrypt flow integration lands in ZL-029.
        </p>
      </div>

      {decryptFetchPayload ? <DecryptFetchSummary payload={decryptFetchPayload} /> : null}
      {decryptFetchError ? (
        <DecryptFetchErrorPanel error={decryptFetchError} onRetry={onRetry} />
      ) : null}
    </section>
  );
}

function LoadingStep() {
  return (
    <section className="space-y-2" data-testid="share-step-loading">
      <h3 className="text-base font-semibold text-foreground">Loading Channel State</h3>
      <p className="text-xs text-muted-foreground">Fetching secure channel status for this link.</p>
    </section>
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
  const [decryptFetchPayload, setDecryptFetchPayload] = useState<DecryptFetchResponse | null>(null);
  const [decryptFetchError, setDecryptFetchError] = useState<string | null>(null);
  const [decryptFetchAttempt, setDecryptFetchAttempt] = useState(0);
  const [isPublicStatusLoading, setIsPublicStatusLoading] = useState(() => Boolean(uuid));
  const [publicStatusResolvedUuid, setPublicStatusResolvedUuid] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid) {
      setChannelState(CHANNEL_STATE.WAITING);
      setDecryptFetchPayload(null);
      setDecryptFetchError(null);
      setPublicStatusResolvedUuid(null);
      setIsPublicStatusLoading(false);
      return;
    }

    const currentUuid = uuid;
    setChannelState(CHANNEL_STATE.WAITING);
    setDecryptFetchPayload(null);
    setDecryptFetchError(null);
    setPublicStatusResolvedUuid(null);
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
          setPublicStatusResolvedUuid(currentUuid);
          setIsPublicStatusLoading(false);
          return;
        }

        setChannelState(parsedPayload.data.state);
        setPublicStatusResolvedUuid(currentUuid);
        setIsPublicStatusLoading(false);
      } catch {
        if (!cancelled) {
          setChannelState(CHANNEL_STATE.WAITING);
          setPublicStatusResolvedUuid(currentUuid);
          setIsPublicStatusLoading(false);
        }
      }
    }

    void loadChannelState();
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  useEffect(() => {
    if (!uuid || publicStatusResolvedUuid !== uuid || channelState !== CHANNEL_STATE.DELIVERED) {
      setDecryptFetchPayload(null);
      setDecryptFetchError(null);
      return;
    }

    let cancelled = false;
    async function loadDecryptPayload(): Promise<void> {
      try {
        const response = await fetch(`/api/decrypt_fetch/${uuid}`);
        if (!response.ok) throw new Error('decrypt fetch request failed');

        const payload = (await response.json()) as unknown;
        const parsedPayload = parseDecryptFetchPayload(payload);
        if (!parsedPayload) throw new Error('decrypt fetch payload invalid');

        if (!cancelled) {
          setDecryptFetchPayload(parsedPayload);
          setDecryptFetchError(null);
        }
      } catch {
        if (!cancelled) {
          setDecryptFetchPayload(null);
          setDecryptFetchError('Unable to load encrypted payload preview.');
        }
      }
    }

    void loadDecryptPayload();
    return () => {
      cancelled = true;
    };
  }, [channelState, uuid, decryptFetchAttempt, publicStatusResolvedUuid]);

  return {
    channelState,
    decryptFetchPayload,
    decryptFetchError,
    isPublicStatusLoading,
    retryFetch: () => setDecryptFetchAttempt((n) => n + 1),
  };
}

function useSharePageLockLogic(uuid?: string, hash?: string) {
  const store = useLockStore();
  const [lockError, setLockError] = useState<string | null>(null);
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
      return;
    }
    const parsedUuid = UUIDSchema.safeParse(uuid);
    useLockStore.getState().setLockUuid(parsedUuid.success ? parsedUuid.data : null);
    setLockError(null);
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

  function handlePassphraseChange(value: string): void {
    store.setPassphrase(value);
    if (lockError) setLockError(null);
  }

  async function handleGenerate(): Promise<void> {
    if (lockPending) return;

    if (!store.uuid) return setLockError(mapLockError('INVALID_REQUEST'));
    if (!lockSecretB64u) return setLockError(mapLockError('INVALID_LOCK_SECRET'));
    if (store.passphrase.trim().length === 0)
      return setLockError(mapLockError('PASSPHRASE_REQUIRED'));

    setLockError(null);
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
      setLockError(mapLockError('INTERNAL_ERROR'));
      return;
    }

    if (!mountedRef.current) return;
    setIsLockSubmitting(false);
    if (!result.ok) return setLockError(mapLockError(result.error.code));
    setLockError(null);
  }

  return {
    store,
    lockError,
    setLockError,
    lockPending,
    canGenerate,
    lockSecretWarning,
    handlePassphraseChange,
    handleGenerate,
  };
}

/**
 * Receiver page integrating lock flow with orchestrator while preserving existing delivered preview.
 */
export function SharePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();
  const location = useLocation();
  const publicState = usePublicShareState(uuid);
  const lockLogic = useSharePageLockLogic(uuid, location.hash);

  return (
    <PageCard data-testid="page-share" tone="cyan">
      <SharePageHeader />
      <PageCardContent className="space-y-6">
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
                lockError={lockLogic.lockError}
                lockPending={lockLogic.lockPending}
                lockSecretWarning={lockLogic.lockSecretWarning}
                onBack={() => {
                  if (lockLogic.lockPending) return;
                  lockLogic.setLockError(null);
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

        {!publicState.isPublicStatusLoading &&
        publicState.channelState === CHANNEL_STATE.DELIVERED ? (
          <DeliveredStep
            decryptFetchError={publicState.decryptFetchError}
            decryptFetchPayload={publicState.decryptFetchPayload}
            onRetry={publicState.retryFetch}
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
