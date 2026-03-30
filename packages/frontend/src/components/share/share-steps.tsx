import type { SafetyCodeDisplay } from '@zerolink/shared';
import { KeyRound, Unlock } from 'lucide-react';
import { useMemo, useState } from 'react';
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
    <div aria-hidden="true" className="max-w-[46rem] space-y-2">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors duration-300',
              i + 1 < current ? 'bg-primary/45' : i + 1 === current ? 'bg-primary' : 'bg-border/50'
            )}
            key={labels[i]}
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
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
    return <SafetyCode density="compact" display={safetyCodeAvailable} />;
  }

  const effectiveStatus =
    safetyCodeStatus === 'not-applicable' || safetyCodeStatus === 'verified-local-key'
      ? 'missing-receiver-fingerprint'
      : safetyCodeStatus;

  const { tone, title, body } = getSafetyCodeCopy(effectiveStatus, t);

  return (
    <StateNotice data-testid="share-safety-unavailable" title={title} tone={tone}>
      <p className="mt-1 text-sm leading-6 text-foreground/90">{body}</p>
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
      <p className="mt-1 text-sm leading-6 text-foreground/90">{body}</p>
    </StateNotice>
  );
}

export function OnboardingStep({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();

  const onboardingItems = useMemo(
    () => [
      {
        title: t('share.onboarding1Title'),
        description: t('share.onboarding1Desc'),
      },
      {
        title: t('share.onboarding2Title'),
        description: t('share.onboarding2Desc'),
      },
      {
        title: t('share.onboarding3Title'),
        description: t('share.onboarding3Desc'),
      },
    ],
    [t]
  );

  return (
    <section className="max-w-[52rem] space-y-4" data-testid="share-step-onboarding">
      <h3 className="text-base font-semibold text-foreground">{t('share.onboardingTitle')}</h3>
      <div className="space-y-3">
        {onboardingItems.map((item, index) => (
          <div
            className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card/50 p-4"
            data-testid={`share-onboarding-card-${index + 1}`}
            key={item.title}
          >
            <span className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full border border-border/70 bg-background/30 text-xs font-semibold tracking-[0.18em] text-primary">
              {`0${index + 1}`}
            </span>
            <div className="space-y-1">
              <p className="font-medium text-foreground">{item.title}</p>
              <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
            </div>
          </div>
        ))}
      </div>
      <Button
        className="w-full sm:w-auto"
        data-testid="share-continue-button"
        onClick={onContinue}
        type="button"
      >
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
  originalShareUrl,
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
  originalShareUrl: string | null;
  onPassphraseChange: (value: string) => void;
  onBack: () => void;
  onGenerate: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function handleCopyLink(): void {
    if (!originalShareUrl || !navigator.clipboard) return;
    const absolute = new URL(originalShareUrl, window.location.origin).href;
    void navigator.clipboard.writeText(absolute).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // Clipboard write failed (permission denied or unsupported); leave button label unchanged
      }
    );
  }

  return (
    <section className="max-w-[52rem] space-y-4" data-testid="share-step-lock">
      <h3 className="text-base font-semibold text-foreground">{t('share.lockTitle')}</h3>

      {originalShareUrl ? (
        <StateNotice data-testid="share-private-mode-notice" tone="warning">
          <p className="text-sm leading-6">{t('share.privateModeNoticeBody')}</p>
          <button
            className="mt-2 text-sm font-medium underline underline-offset-2 hover:opacity-80"
            data-testid="share-private-mode-copy"
            onClick={handleCopyLink}
            type="button"
          >
            {copied ? t('share.privateModeNoticeCopied') : t('share.privateModeNoticeCopy')}
          </button>
        </StateNotice>
      ) : null}

      <PassphraseInput
        ariaDescribedBy={lockError && isLockPassphraseInvalid ? 'share-lock-error' : undefined}
        ariaInvalid={isLockPassphraseInvalid ? true : undefined}
        helperText={t('passphrase.policyHint')}
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

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          className="w-full sm:w-auto"
          data-testid="share-back-button"
          disabled={lockPending}
          onClick={onBack}
          type="button"
          variant="secondary"
        >
          {t('share.backButton')}
        </Button>
        <Button
          className="w-full sm:w-auto"
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
    <section className="max-w-[52rem] space-y-4" data-testid="share-step-locked">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{t('share.lockedTitle')}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{t('share.lockedBody')}</p>
      </div>

      <SafetyCodeSection
        safetyCodeAvailable={safetyCodeAvailable}
        safetyCodeStatus={safetyCodeStatus}
      />

      <div
        className="space-y-2 rounded-2xl border border-border/60 bg-muted/18 p-4"
        data-testid="share-next-steps"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {t('share.nextStepsLabel')}
        </p>
        <ol className="space-y-2 text-sm leading-6 text-foreground">
          {nextSteps.map((stepText, index) => (
            <li className="flex items-start gap-3" key={stepText}>
              <span className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border border-border/70 bg-background/30 text-xs font-semibold text-primary">
                {index + 1}
              </span>
              <span>{stepText}</span>
            </li>
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
    <section className="max-w-[52rem] space-y-4" data-testid="share-step-delivered">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{t('share.deliveredTitle')}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{t('share.deliveredBody')}</p>
      </div>

      {deliveredAt !== null ? (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground" data-testid="share-delivery-timestamp">
            {t('share.deliveredAtLabel')} {formatDeliveredAt(deliveredAt)}
          </p>
          {cipherVersion !== null && cipherVersion >= 1 ? (
            <output
              className="block text-sm font-medium text-amber-200"
              data-testid="share-delivery-updated-badge"
            >
              {t('share.updatedBadge', { version: cipherVersion + 1 })}
            </output>
          ) : null}
        </div>
      ) : null}

      {canDecryptLocally ? (
        <>
          {cipherVersion !== null && cipherVersion >= 1 && !plaintext ? (
            <StateNotice data-testid="share-cipher-version-notice" tone="info">
              <p className="text-sm">{t('share.cipherVersionNotice')}</p>
            </StateNotice>
          ) : null}
          <div
            aria-busy={decryptPending}
            className="space-y-4 rounded-2xl border border-border/60 bg-muted/18 p-4 sm:p-5"
            data-testid="share-decrypt-panel"
          >
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
              className="space-y-2 rounded-2xl border border-emerald-300/20 bg-emerald-400/8 p-4"
              data-testid="share-decrypt-plaintext"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200">
                {t('share.plaintextLabel')}
              </p>
              <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
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
              <p className="mt-1 text-sm text-foreground/85">{t('share.burnedBody')}</p>
            </StateNotice>
          ) : null}
        </>
      ) : (
        <DecryptUnavailableNotice safetyCodeStatus={safetyCodeStatus} />
      )}

      <SafetyCodeSection
        safetyCodeAvailable={safetyCodeAvailable}
        safetyCodeStatus={safetyCodeStatus}
      />
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
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
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
