import { type ChannelTtlMs, SECURITY_PROFILE, type SecurityProfile } from '@zerolink/shared';
import { Lock, Shield, Zap } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

import { StateNotice } from '../../components/layout';
import { PassphraseInput } from '../../components/lock/passphrase-input';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import { cn } from '../../lib/utils';
import { createTrustRouteState } from '../../trust-route-state';
import { CHANNEL_TTL_OPTIONS, getChannelTtlLabel } from './helpers';

type ModeCardProps = {
  title: string;
  description: string;
  icon: typeof Lock;
  selected: boolean;
  onClick: () => void;
  'data-testid'?: string;
};

function ModeCard({
  title,
  description,
  icon: Icon,
  selected,
  onClick,
  'data-testid': testId,
}: ModeCardProps) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        'flex w-full flex-col items-start gap-3 rounded-xl border p-5 text-left transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-border/60',
        selected
          ? 'border-primary/70 bg-primary/5 ring-2 ring-primary/40'
          : 'border-border/50 bg-card/60'
      )}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      <div
        className={cn(
          'rounded-md border p-2 transition-colors',
          selected
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-border/70 bg-card/60 text-muted-foreground'
        )}
      >
        <Icon aria-hidden="true" className="size-5" />
      </div>
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

export function ModeSelectorGrid({
  selected,
  webAuthnSupported,
  onSelect,
}: {
  selected: SecurityProfile;
  webAuthnSupported: boolean;
  onSelect: (profile: SecurityProfile) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">{t('create.chooseModeTitle')}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <ModeCard
          data-testid="mode-card-quick"
          description={t('create.quickShareDescription')}
          icon={Lock}
          onClick={() => onSelect(SECURITY_PROFILE.QUICK)}
          selected={selected === SECURITY_PROFILE.QUICK}
          title={t('create.quickShareTitle')}
        />
        <ModeCard
          data-testid="mode-card-secure"
          description={
            webAuthnSupported
              ? t('create.secureShareDescriptionAvailable')
              : t('create.secureShareDescriptionUnavailable')
          }
          icon={Shield}
          onClick={() => {
            if (webAuthnSupported) onSelect(SECURITY_PROFILE.SECURE);
          }}
          selected={selected === SECURITY_PROFILE.SECURE}
          title={t('create.secureShareTitle')}
        />
      </div>
      {selected === SECURITY_PROFILE.SECURE ? (
        <div
          className="rounded-xl border border-neon-cyan/30 bg-neon-cyan/10 p-4 text-sm text-muted-foreground"
          data-testid="create-secure-share-hint"
        >
          {t('create.secureShareHint')}
        </div>
      ) : null}
      {!webAuthnSupported ? (
        <StateNotice
          data-testid="create-webauthn-blocked-warning"
          title={t('create.webauthnBlockedTitle')}
          tone="warning"
        >
          <p className="text-neon-orange">{t('create.webauthnBlockedBody')}</p>
        </StateNotice>
      ) : null}
    </section>
  );
}

export function HowItWorks() {
  const { t } = useTranslation();

  const steps = useMemo(
    () => [
      {
        number: '01',
        numberClass: 'text-neon-cyan',
        title: t('create.step1Title'),
        description: t('create.step1Desc'),
      },
      {
        number: '02',
        numberClass: 'text-neon-magenta',
        title: t('create.step2Title'),
        description: t('create.step2Desc'),
      },
      {
        number: '03',
        numberClass: 'text-neon-orange',
        title: t('create.step3Title'),
        description: t('create.step3Desc'),
      },
      {
        number: '04',
        numberClass: 'text-neon-green',
        title: t('create.step4Title'),
        description: t('create.step4Desc'),
      },
    ],
    [t]
  );

  return (
    <section
      className="rounded-xl border border-border/40 bg-muted/30 p-4"
      data-testid="how-it-works"
    >
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('create.howItWorksLabel')}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <div className="space-y-1" key={step.number}>
            <p className="text-sm font-medium text-foreground">
              <span className={cn('mr-1.5 text-xs', step.numberClass)}>{step.number}</span>
              {step.title}
            </p>
            <p className="text-xs text-muted-foreground">{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function TrustModelHint() {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <section className="rounded-xl border border-neon-cyan/30 bg-neon-cyan/10 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">{t('create.trustHintBody')}</p>
        <Link
          className="text-sm font-medium text-neon-cyan underline decoration-neon-cyan/50 underline-offset-4 transition-colors hover:text-white"
          data-testid="create-trust-link"
          state={createTrustRouteState(location)}
          to="/trust"
        >
          {t('create.trustHintLink')}
        </Link>
      </div>
    </section>
  );
}

export function QuickSharePasswordPanel({
  password,
  onPasswordChange,
}: {
  password: string;
  onPasswordChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="space-y-3 rounded-xl border border-neon-purple/35 bg-neon-purple/10 p-4 text-sm"
      data-testid="quick-share-password-panel"
    >
      <p className="font-medium text-foreground">{t('create.passwordPanelTitle')}</p>
      <p className="text-muted-foreground">{t('create.passwordPanelBody')}</p>
      <PassphraseInput
        helperText={t('passphrase.policyHint')}
        inputId="create-quick-password"
        label={t('create.passwordLabel')}
        onChange={onPasswordChange}
        placeholder={t('create.passwordPlaceholder')}
        showStrength
        value={password}
      />
    </div>
  );
}

export function ExpirySelector({
  selected,
  onSelect,
}: {
  selected: ChannelTtlMs;
  onSelect: (ttl: ChannelTtlMs) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground" id={titleId}>
          {t('create.expiryTitle')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('create.expiryDescription')}</p>
      </div>
      <div aria-labelledby={titleId} className="grid gap-3 sm:grid-cols-3" role="radiogroup">
        {CHANNEL_TTL_OPTIONS.map((option) => {
          const isSelected = selected === option.value;
          return (
            <label className="block cursor-pointer" key={option.value}>
              <input
                checked={isSelected}
                className="sr-only"
                data-testid={option.testId}
                name="channel-ttl"
                onChange={() => onSelect(option.value)}
                type="radio"
                value={String(option.value)}
              />
              <span
                className={cn(
                  'block rounded-xl border px-4 py-3 text-left transition-all duration-200',
                  'hover:-translate-y-0.5 hover:border-border/60',
                  isSelected
                    ? 'border-primary/70 bg-primary/5 ring-2 ring-primary/40'
                    : 'border-border/50 bg-card/60'
                )}
              >
                <span className="font-semibold text-foreground">
                  {getChannelTtlLabel(t, option.value)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

export function ActionFooter({
  onCreate,
  disabled,
  isLoading,
}: {
  onCreate: () => void;
  disabled: boolean;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        data-testid="create-submit-button"
        disabled={disabled}
        onClick={onCreate}
        type="button"
      >
        {isLoading ? (
          <>
            <Spinner aria-hidden="true" className="size-4" />
            {t('create.submittingButton')}
          </>
        ) : (
          <>
            <Zap aria-hidden="true" className="size-4" />
            {t('create.submitButton')}
          </>
        )}
      </Button>
    </div>
  );
}
