import type { SafetyCodeDisplay } from '@zerolink/shared';
import { KeyRound, Unlock } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StateNotice } from '../../components/layout';
import { PassphraseInput } from '../../components/lock/passphrase-input';
import { SafetyCode } from '../../components/safety/safety-code';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import type { ReceiverSafetyCodeStatus } from '../../features/share/share-logic';
import { cn } from '../../lib/utils';
import { ChannelUnavailableState } from '../channel/channel-unavailable-state';

export function StepIndicator({
  current,
  total,
  labels,
}: {
  current: number;
  total: number;
  labels: readonly string[];
}) {
  const { t } = useTranslation();
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
        {t('share.stepIndicator', { current, total, label: labels[current - 1] })}
      </p>
    </div>
  );
}

type NoticeCopy = { tone: 'info' | 'warning' | 'error'; title: string; body: string };

function getSafetyCodeCopy(
  status: Exclude<ReceiverSafetyCodeStatus, 'not-applicable' | 'verified-local-key'>,
  t: ReturnType<typeof useTranslation>['t']
): NoticeCopy {
  switch (status) {
    case 'checking-local-key':
      return {
        tone: 'info',
        title: t('share.safetyCheckingTitle'),
        body: t('share.safetyCheckingBody'),
      };
    case 'missing-local-key':
      return {
        tone: 'warning',
        title: t('share.safetyMissingTitle'),
        body: t('share.safetyMissingBody'),
      };
    case 'mismatched-local-key':
      return {
        tone: 'error',
        title: t('share.safetyMismatchedTitle'),
        body: t('share.safetyMismatchedBody'),
      };
    case 'storage-error':
      return {
        tone: 'warning',
        title: t('share.safetyStorageErrorTitle'),
        body: t('share.safetyStorageErrorBody'),
      };
    // biome-ignore lint/complexity/noUselessSwitchCase: explicit enumeration for readability
    case 'missing-receiver-fingerprint':
    default:
      return {
        tone: 'warning',
        title: t('share.safetyUnavailableTitle'),
        body: t('share.safetyUnavailableBody'),
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
  const { t } = useTranslation();

  if (safetyCodeAvailable) {
    return <SafetyCode display={safetyCodeAvailable} />;
  }

  const effectiveStatus =
    safetyCodeStatus === 'not-applicable' || safetyCodeStatus === 'verified-local-key'
      ? 'missing-receiver-fingerprint'
      : safetyCodeStatus;

  const { tone, title, body } = getSafetyCodeCopy(effectiveStatus, t);

  return (
    <StateNotice data-testid="share-safety-unavailable" title={title} tone={tone}>
      <p className="mt-1 text-xs text-foreground/90">{body}</p>
    </StateNotice>
  );
}

function getDecryptUnavailableCopy(
  status: Exclude<ReceiverSafetyCodeStatus, 'not-applicable' | 'verified-local-key'>,
  t: ReturnType<typeof useTranslation>['t']
): NoticeCopy {
  switch (status) {
    case 'checking-local-key':
      return {
        tone: 'info',
        title: t('share.decryptCheckingTitle'),
        body: t('share.decryptCheckingBody'),
      };
    case 'mismatched-local-key':
      return {
        tone: 'error',
        title: t('share.decryptMismatchedTitle'),
        body: t('share.decryptMismatchedBody'),
      };
    case 'storage-error':
      return {
        tone: 'warning',
        title: t('share.decryptStorageErrorTitle'),
        body: t('share.decryptStorageErrorBody'),
      };
    // biome-ignore lint/complexity/noUselessSwitchCase: explicit enumeration for readability
    case 'missing-local-key':
    // biome-ignore lint/complexity/noUselessSwitchCase: explicit enumeration for readability
    case 'missing-receiver-fingerprint':
    default:
      return {
        tone: 'warning',
        title: t('share.decryptUnavailableTitle'),
        body: t('share.decryptUnavailableBody'),
      };
  }
}

function DecryptUnavailableNotice({
  safetyCodeStatus,
}: {
  safetyCodeStatus: ReceiverSafetyCodeStatus;
}) {
  const { t } = useTranslation();

  const effectiveStatus =
    safetyCodeStatus === 'not-applicable' || safetyCodeStatus === 'verified-local-key'
      ? 'missing-local-key'
      : safetyCodeStatus;

  const { tone, title, body } = getDecryptUnavailableCopy(effectiveStatus, t);

  return (
    <StateNotice data-testid="share-decrypt-unavailable" title={title} tone={tone}>
      <p className="mt-1 text-xs text-foreground/90">{body}</p>
    </StateNotice>
  );
}

export function OnboardingStep({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();

  const onboardingItems = useMemo(
    () => [
      {
        emoji: '🔐',
        title: t('share.onboarding1Title'),
        description: t('share.onboarding1Desc'),
      },
      {
        emoji: '🗝️',
        title: t('share.onboarding2Title'),
        description: t('share.onboarding2Desc'),
      },
      {
        emoji: '🔒',
        title: t('share.onboarding3Title'),
        description: t('share.onboarding3Desc'),
      },
    ],
    [t]
  );

  return (
    <section className="space-y-4" data-testid="share-step-onboarding">
      <h3 className="text-base font-semibold text-foreground">{t('share.onboardingTitle')}</h3>
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
        {t('share.continueButton')}
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
  const { t } = useTranslation();
  return (
    <section className="space-y-4" data-testid="share-step-lock">
      <h3 className="text-base font-semibold text-foreground">{t('share.lockTitle')}</h3>
      <PassphraseInput
        ariaDescribedBy={lockError && isLockPassphraseInvalid ? 'share-lock-error' : undefined}
        ariaInvalid={isLockPassphraseInvalid ? true : undefined}
        inputId="share-lock-passphrase"
        label={t('share.lockLabel')}
        onChange={onPassphraseChange}
        placeholder={t('share.lockPlaceholder')}
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
          {t('share.backButton')}
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
              {t('share.lockingButton')}
            </>
          ) : (
            <>
              <KeyRound aria-hidden="true" className="size-4" />
              {t('share.generateButton')}
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
  const { t } = useTranslation();

  const nextSteps = useMemo(
    () => [t('share.nextStep1'), t('share.nextStep2'), t('share.nextStep3')],
    [t]
  );

  return (
    <section className="space-y-4" data-testid="share-step-locked">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{t('share.lockedTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('share.lockedBody')}</p>
      </div>

      <SafetyCodeSection
        safetyCodeAvailable={safetyCodeAvailable}
        safetyCodeStatus={safetyCodeStatus}
      />

      <div
        className="space-y-2 rounded-xl border border-neon-cyan/35 bg-neon-cyan/10 p-4"
        data-testid="share-next-steps"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-neon-cyan">
          {t('share.nextStepsLabel')}
        </p>
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

function formatDeliveredAt(ts: number): string {
  return new Date(ts).toLocaleString();
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
  deliveredAt,
  cipherVersion,
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
  deliveredAt: number | null;
  cipherVersion: number | null;
  onPassphraseChange: (value: string) => void;
  onDecrypt: () => void;
  onBurn: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-4" data-testid="share-step-delivered">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{t('share.deliveredTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('share.deliveredBody')}</p>
      </div>

      {deliveredAt !== null ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground" data-testid="share-delivery-timestamp">
            {t('share.deliveredAtLabel')} {formatDeliveredAt(deliveredAt)}
          </p>
          {cipherVersion !== null && cipherVersion >= 1 ? (
            <output
              className="block text-xs font-medium text-neon-orange"
              data-testid="share-delivery-updated-badge"
            >
              {t('share.updatedBadge', { version: cipherVersion + 1 })}
            </output>
          ) : null}
        </div>
      ) : null}

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
              label={t('share.decryptLabel')}
              onChange={onPassphraseChange}
              placeholder={t('share.decryptPlaceholder')}
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
                    {t('share.decryptingButton')}
                  </>
                ) : (
                  <>
                    <Unlock aria-hidden="true" className="size-4" />
                    {t('share.decryptButton')}
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
                {t('share.burnButton')}
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
                {t('share.plaintextLabel')}
              </p>
              <pre className="whitespace-pre-wrap break-words text-sm text-foreground">
                {plaintext}
              </pre>
            </div>
          ) : null}

          {localPlaintextBurned ? (
            <StateNotice
              data-testid="share-decrypt-burned"
              title={t('share.burnedTitle')}
              tone="warning"
            >
              <p className="mt-1 text-xs text-neon-orange">{t('share.burnedBody')}</p>
            </StateNotice>
          ) : null}
        </>
      ) : (
        <DecryptUnavailableNotice safetyCodeStatus={safetyCodeStatus} />
      )}
    </section>
  );
}

export function LoadingStep() {
  const { t } = useTranslation();
  return (
    <StateNotice
      aria-busy="true"
      data-testid="share-step-loading"
      title={t('share.loadingTitle')}
      tone="info"
    >
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        {t('share.loadingBody')}
      </p>
    </StateNotice>
  );
}

export function UnavailableStep() {
  const { t } = useTranslation();
  return (
    <ChannelUnavailableState body={t('share.unavailableBody')} testId="share-step-unavailable" />
  );
}
