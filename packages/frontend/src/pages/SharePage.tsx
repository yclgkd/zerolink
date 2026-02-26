import {
  CHANNEL_STATE,
  type ChannelState,
  type DecryptFetchResponse,
  DecryptFetchResponseSchema,
  type HexString,
  PublicStatusResponseSchema,
} from '@zerolink/shared';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

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

type SharePageStep = 'onboarding' | 'lock' | 'locked';

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

// TODO(ZL-029): Replace with computed safety code from receiver keypair
const PLACEHOLDER_SAFETY_CODE = {
  emoji: {
    type: 'emoji',
    emojis: ['🔥', '🌲', '🚀', '🔮', '💎', '🎯', '⚡', '🌙'],
  },
  color: {
    type: 'color',
    cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
  shortFpr: 'a1b2c3d4e5f6...f1e2d3c4b5a6',
  fullFpr: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00' as HexString,
} as const;

function formatDeliveredAt(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
}

function parseDecryptFetchPayload(payload: unknown): DecryptFetchResponse | null {
  const result = DecryptFetchResponseSchema.safeParse(payload);
  return result.success ? result.data : null;
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
        Receiver-side lock flow UI before decrypt integration.
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
  onPassphraseChange,
  onBack,
  onGenerate,
}: {
  passphrase: string;
  canGenerate: boolean;
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
      <div className="flex gap-2">
        <Button data-testid="share-back-button" onClick={onBack} type="button" variant="secondary">
          Back
        </Button>
        <Button
          data-testid="share-generate-button"
          disabled={!canGenerate}
          onClick={onGenerate}
          type="button"
        >
          Generate Key & Lock
        </Button>
      </div>
    </section>
  );
}

function LockedStep() {
  return (
    <section className="space-y-4" data-testid="share-step-locked">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Channel Locked Successfully</h3>
        <p className="text-xs text-muted-foreground">
          Verify the Safety Code with the sender before delivery.
        </p>
      </div>
      <SafetyCode display={PLACEHOLDER_SAFETY_CODE} />
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

function TerminalStep({
  state,
}: {
  state: typeof CHANNEL_STATE.DELETED | typeof CHANNEL_STATE.EXPIRED;
}) {
  if (state === CHANNEL_STATE.DELETED) {
    return (
      <section className="space-y-2" data-testid="share-step-deleted">
        <h3 className="text-base font-semibold text-foreground">Channel Deleted</h3>
        <p className="text-xs text-muted-foreground">
          This channel has been destroyed and cannot be recovered.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2" data-testid="share-step-expired">
      <h3 className="text-base font-semibold text-foreground">Channel Expired</h3>
      <p className="text-xs text-muted-foreground">
        The channel exceeded its lifetime and is no longer valid for delivery.
      </p>
    </section>
  );
}

function useSharePageState(uuid?: string) {
  const [step, setStep] = useState<SharePageStep>('onboarding');
  const [passphrase, setPassphrase] = useState('');
  const [channelState, setChannelState] = useState<ChannelState>(CHANNEL_STATE.WAITING);
  const [decryptFetchPayload, setDecryptFetchPayload] = useState<DecryptFetchResponse | null>(null);
  const [decryptFetchError, setDecryptFetchError] = useState<string | null>(null);
  const [decryptFetchAttempt, setDecryptFetchAttempt] = useState(0);
  const [isPublicStatusLoading, setIsPublicStatusLoading] = useState(() => Boolean(uuid));
  const [publicStatusResolvedUuid, setPublicStatusResolvedUuid] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid) {
      setStep('onboarding');
      setPassphrase('');
      setChannelState(CHANNEL_STATE.WAITING);
      setDecryptFetchPayload(null);
      setDecryptFetchError(null);
      setPublicStatusResolvedUuid(null);
      setIsPublicStatusLoading(false);
      return;
    }

    const currentUuid = uuid;

    setStep('onboarding');
    setPassphrase('');
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
          setStep('onboarding');
          setPublicStatusResolvedUuid(currentUuid);
          setIsPublicStatusLoading(false);
          return;
        }

        setChannelState(parsedPayload.data.state);
        if (parsedPayload.data.state === CHANNEL_STATE.WAITING) {
          setStep('onboarding');
        } else {
          setStep('locked');
        }
        setPublicStatusResolvedUuid(currentUuid);
        setIsPublicStatusLoading(false);
      } catch {
        if (!cancelled) {
          setChannelState(CHANNEL_STATE.WAITING);
          setStep('onboarding');
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
    step,
    setStep,
    passphrase,
    setPassphrase,
    channelState,
    decryptFetchPayload,
    decryptFetchError,
    isPublicStatusLoading,
    retryFetch: () => setDecryptFetchAttempt((n) => n + 1),
    canGenerate: passphrase.trim().length > 0,
  };
}

/**
 * The receiver page that manages lock and delivered-state UI while decrypt integration is pending.
 */
export function SharePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();
  const state = useSharePageState(uuid);

  function handleGenerate(): void {
    if (!state.canGenerate) return;
    state.setPassphrase('');
    state.setStep('locked');
  }

  return (
    <PageCard data-testid="page-share" tone="cyan">
      <SharePageHeader />
      <PageCardContent className="space-y-6">
        <UuidDisplay uuid={uuid} />

        {state.isPublicStatusLoading ? <LoadingStep /> : null}

        {!state.isPublicStatusLoading && state.channelState === CHANNEL_STATE.WAITING ? (
          <>
            {state.step === 'onboarding' ? (
              <OnboardingStep onContinue={() => state.setStep('lock')} />
            ) : null}
            {state.step === 'lock' ? (
              <LockStep
                canGenerate={state.canGenerate}
                onBack={() => state.setStep('onboarding')}
                onGenerate={handleGenerate}
                onPassphraseChange={state.setPassphrase}
                passphrase={state.passphrase}
              />
            ) : null}
            {state.step === 'locked' ? <LockedStep /> : null}
          </>
        ) : null}

        {!state.isPublicStatusLoading && state.channelState === CHANNEL_STATE.LOCKED ? (
          <LockedStep />
        ) : null}

        {!state.isPublicStatusLoading && state.channelState === CHANNEL_STATE.DELIVERED ? (
          <DeliveredStep
            decryptFetchError={state.decryptFetchError}
            decryptFetchPayload={state.decryptFetchPayload}
            onRetry={state.retryFetch}
          />
        ) : null}

        {!state.isPublicStatusLoading && state.channelState === CHANNEL_STATE.DELETED ? (
          <TerminalStep state={CHANNEL_STATE.DELETED} />
        ) : null}

        {!state.isPublicStatusLoading && state.channelState === CHANNEL_STATE.EXPIRED ? (
          <TerminalStep state={CHANNEL_STATE.EXPIRED} />
        ) : null}
      </PageCardContent>
    </PageCard>
  );
}
