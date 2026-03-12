import type { SafetyCodeDisplay } from '@zerolink/shared';
import { KeyRound, Unlock } from 'lucide-react';
import { StateNotice } from '../../components/layout';
import { PassphraseInput } from '../../components/lock/passphrase-input';
import { SafetyCode } from '../../components/safety/safety-code';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import type { ReceiverSafetyCodeStatus } from '../../features/share/share-logic';
import { cn } from '../../lib/utils';
import { ChannelUnavailableState } from '../channel/channel-unavailable-state';

export const onboardingItems = [
  {
    emoji: '🔐',
    title: 'This page is only for the receiver using the shared link.',
    description: 'The sender already created the channel and sent you this link.',
  },
  {
    emoji: '🗝️',
    title: 'Your passphrase stays on this device',
    description: 'It never gets sent to the server or shared with the sender.',
  },
  {
    emoji: '🔒',
    title: 'Locking creates your receiver key locally',
    description: 'After you lock, the sender can deliver only to your receiver identity.',
  },
] as const;

export function StepIndicator({
  current,
  total,
  labels,
}: {
  current: number;
  total: number;
  labels: readonly string[];
}) {
  return (
    <div aria-hidden="true" className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              i + 1 < current
                ? 'bg-neon-cyan/60'
                : i + 1 === current
                  ? 'bg-neon-cyan'
                  : 'bg-border/50'
            )}
            key={labels[i]}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Step {current} of {total} — {labels[current - 1]}
      </p>
    </div>
  );
}

export const nextSteps = [
  'Coordinate with the sender over another channel.',
  'Only confirm the Safety Code if this device shows it below.',
  'This page updates automatically when the sender delivers the encrypted secret.',
] as const;

const SAFETY_CODE_UNAVAILABLE_TITLE = 'Safety Code unavailable right now.';
const SAFETY_CODE_UNAVAILABLE_BODY =
  'Receiver fingerprint is missing from the current channel state, so the Safety Code cannot be verified here.';

function getSafetyCodeNoticeCopy(
  status: Exclude<ReceiverSafetyCodeStatus, 'not-applicable' | 'verified-local-key'>
) {
  switch (status) {
    case 'checking-local-key':
      return {
        tone: 'info' as const,
        title: 'Checking this device for the receiver key…',
        body: 'ZeroLink only shows the Safety Code after confirming that this device created the current lock.',
      };
    case 'missing-local-key':
      return {
        tone: 'warning' as const,
        title: 'This device cannot verify the Safety Code.',
        body: 'No matching receiver key was found on this device. Do not confirm the Safety Code from here. If you expected to be the receiver, ask the sender to recreate the channel.',
      };
    case 'mismatched-local-key':
      return {
        tone: 'error' as const,
        title: 'Receiver identity mismatch detected.',
        body: 'This device has different local receiver key material than the key currently locked on the channel. Treat this link as unsafe and ask the sender to recreate the channel.',
      };
    case 'storage-error':
      return {
        tone: 'warning' as const,
        title: 'Unable to check the local receiver key.',
        body: 'ZeroLink could not read the receiver key material stored on this device, so the Safety Code cannot be verified here.',
      };
    case 'missing-receiver-fingerprint':
    default:
      return {
        tone: 'warning' as const,
        title: SAFETY_CODE_UNAVAILABLE_TITLE,
        body: SAFETY_CODE_UNAVAILABLE_BODY,
      };
  }
}

function SafetyCodeSection({
  safetyCodeAvailable,
  safetyCodeStatus,
}: {
  safetyCodeAvailable: SafetyCodeDisplay | null;
  safetyCodeStatus: ReceiverSafetyCodeStatus;
}) {
  if (safetyCodeAvailable) {
    return <SafetyCode display={safetyCodeAvailable} />;
  }

  const noticeCopy = getSafetyCodeNoticeCopy(
    safetyCodeStatus === 'not-applicable' || safetyCodeStatus === 'verified-local-key'
      ? 'missing-receiver-fingerprint'
      : safetyCodeStatus
  );

  return (
    <StateNotice
      data-testid="share-safety-unavailable"
      title={noticeCopy.title}
      tone={noticeCopy.tone}
    >
      <p className="mt-1 text-xs text-foreground/90">{noticeCopy.body}</p>
    </StateNotice>
  );
}

function getDecryptUnavailableCopy(
  status: Exclude<ReceiverSafetyCodeStatus, 'not-applicable' | 'verified-local-key'>
) {
  switch (status) {
    case 'checking-local-key':
      return {
        tone: 'info' as const,
        title: 'Checking this device before enabling decrypt…',
        body: 'ZeroLink is verifying whether this device holds the receiver key needed for local decryption.',
      };
    case 'mismatched-local-key':
      return {
        tone: 'error' as const,
        title: 'Decrypt blocked on this device.',
        body: 'The receiver key stored on this device does not match the key currently locked on the channel. Treat this link as unsafe and ask the sender to recreate the channel.',
      };
    case 'storage-error':
      return {
        tone: 'warning' as const,
        title: 'Unable to load the local receiver key.',
        body: 'ZeroLink could not read the receiver key stored on this device, so local decrypt is unavailable here.',
      };
    case 'missing-local-key':
    case 'missing-receiver-fingerprint':
    default:
      return {
        tone: 'warning' as const,
        title: 'Decrypt unavailable on this device.',
        body: 'This device does not have the receiver key that locked the channel, so local decrypt is blocked here.',
      };
  }
}

export function OnboardingStep({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="space-y-4" data-testid="share-step-onboarding">
      <h3 className="text-base font-semibold text-foreground">Receiver Lock Setup</h3>
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
        Continue as receiver
      </Button>
    </section>
  );
}

export function LockStep({
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
      <h3 className="text-base font-semibold text-foreground">Choose your passphrase</h3>
      <PassphraseInput
        ariaDescribedBy={lockError && isLockPassphraseInvalid ? 'share-lock-error' : undefined}
        ariaInvalid={isLockPassphraseInvalid ? true : undefined}
        inputId="share-lock-passphrase"
        label="Your passphrase"
        onChange={onPassphraseChange}
        placeholder="Enter your passphrase"
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
          {lockPending ? (
            <>
              <Spinner aria-hidden="true" className="size-4" />
              Locking…
            </>
          ) : (
            <>
              <KeyRound aria-hidden="true" className="size-4" />
              Generate My Key & Lock
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

export function LockedStep({
  safetyCodeAvailable,
  safetyCodeStatus,
}: {
  safetyCodeAvailable: SafetyCodeDisplay | null;
  safetyCodeStatus: ReceiverSafetyCodeStatus;
}) {
  return (
    <section className="space-y-4" data-testid="share-step-locked">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Receiver channel is locked</h3>
        <p className="text-xs text-muted-foreground">
          Verify the Safety Code with the sender only if this device shows it below.
        </p>
      </div>

      <SafetyCodeSection
        safetyCodeAvailable={safetyCodeAvailable}
        safetyCodeStatus={safetyCodeStatus}
      />

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

export function DecryptErrorPanel({ error }: { error: string }) {
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

export function DeliveredStep({
  safetyCodeAvailable,
  safetyCodeStatus,
  canDecryptLocally,
  passphrase,
  decryptPending,
  decryptError,
  isDecryptPassphraseInvalid,
  plaintext,
  localPlaintextBurned,
  canDecrypt,
  canBurn,
  onPassphraseChange,
  onDecrypt,
  onBurn,
}: {
  safetyCodeAvailable: SafetyCodeDisplay | null;
  safetyCodeStatus: ReceiverSafetyCodeStatus;
  canDecryptLocally: boolean;
  passphrase: string;
  decryptPending: boolean;
  decryptError: string | null;
  isDecryptPassphraseInvalid: boolean;
  plaintext: string | null;
  localPlaintextBurned: boolean;
  canDecrypt: boolean;
  canBurn: boolean;
  onPassphraseChange: (value: string) => void;
  onDecrypt: () => void;
  onBurn: () => void;
}) {
  const decryptUnavailableCopy = getDecryptUnavailableCopy(
    safetyCodeStatus === 'not-applicable' || safetyCodeStatus === 'verified-local-key'
      ? 'missing-local-key'
      : safetyCodeStatus
  );

  return (
    <section className="space-y-4" data-testid="share-step-delivered">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Channel Delivered</h3>
        <p className="text-xs text-muted-foreground">
          The encrypted secret has been delivered. Decryption still requires the device that created
          the receiver lock.
        </p>
      </div>

      <SafetyCodeSection
        safetyCodeAvailable={safetyCodeAvailable}
        safetyCodeStatus={safetyCodeStatus}
      />

      {canDecryptLocally ? (
        <>
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
                {decryptPending ? (
                  <>
                    <Spinner aria-hidden="true" className="size-4" />
                    Decrypting…
                  </>
                ) : (
                  <>
                    <Unlock aria-hidden="true" className="size-4" />
                    Decrypt
                  </>
                )}
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
              <p className="text-xs font-medium uppercase tracking-wide text-neon-green">
                Plaintext
              </p>
              <pre className="whitespace-pre-wrap break-words text-sm text-foreground">
                {plaintext}
              </pre>
            </div>
          ) : null}

          {localPlaintextBurned ? (
            <StateNotice
              data-testid="share-decrypt-burned"
              title="Local plaintext removed from this device."
              tone="warning"
            >
              <p className="mt-1 text-xs text-neon-orange">
                This does not delete the channel or mark it expired. Re-enter your passphrase to
                decrypt again.
              </p>
            </StateNotice>
          ) : null}
        </>
      ) : (
        <StateNotice
          data-testid="share-decrypt-unavailable"
          title={decryptUnavailableCopy.title}
          tone={decryptUnavailableCopy.tone}
        >
          <p className="mt-1 text-xs text-foreground/90">{decryptUnavailableCopy.body}</p>
        </StateNotice>
      )}
    </section>
  );
}

export function LoadingStep() {
  return (
    <StateNotice
      aria-busy="true"
      data-testid="share-step-loading"
      title="Loading Channel State"
      tone="info"
    >
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        Fetching secure channel status for this link.
      </p>
    </StateNotice>
  );
}

export function UnavailableStep() {
  return (
    <ChannelUnavailableState
      body="This channel was destroyed, expired, or does not exist."
      testId="share-step-unavailable"
    />
  );
}
