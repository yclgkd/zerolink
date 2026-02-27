import type { SafetyCodeDisplay } from '@zerolink/shared';
import { CHANNEL_STATE } from '@zerolink/shared';

import { StateNotice } from '../../components/layout';
import { PassphraseInput } from '../../components/lock/passphrase-input';
import { SafetyCode } from '../../components/safety/safety-code';
import { Button } from '../../components/ui/button';

export const onboardingItems = [
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

export const nextSteps = [
  'Contact the sender through another channel.',
  'Compare Safety Code values before delivery.',
  'Keep this tab open until the sender confirms delivery.',
] as const;

export function OnboardingStep({ onContinue }: { onContinue: () => void }) {
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

export function LockedStep({
  safetyCodeAvailable,
}: {
  safetyCodeAvailable: SafetyCodeDisplay | null;
}) {
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

export function LoadingStep() {
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

export function TerminalStep({
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
