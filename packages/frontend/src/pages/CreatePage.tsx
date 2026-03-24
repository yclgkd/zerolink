import {
  buildManageUrlWithFragment,
  SECURITY_PROFILE,
  type SecurityProfile,
} from '@zerolink/shared';
import i18next from 'i18next';
import { AlertTriangle, ClipboardCheck, Copy, Lock, PlusCircle, Shield, Zap } from 'lucide-react';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
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
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/spinner';
import { cryptoOrchestrator } from '../crypto/orchestrator';
import { hasRequiredPassphraseLength } from '../crypto/passphrase-policy';
import { detectWebAuthnSupport } from '../crypto/webauthn';
import { serializeWrappedKeyCompact } from '../crypto/wrapped-key-codec';
import { generateChannelUuid } from '../lib/channel-uuid';
import { cn } from '../lib/utils';
import type { CreateStore } from '../stores/create-store';
import { useCreateStore } from '../stores/create-store';
import { createTrustRouteState } from '../trust-route-state';

interface CreatedLinks {
  shareUrlWithFragment: string;
  manageUrl: string;
  isPasswordMode: boolean;
}

function mapCreateError(code: string): string {
  switch (code) {
    case 'PROFILE_BLOCKED':
      return i18next.t('create.errorProfileBlocked');
    case 'PASSPHRASE_REQUIRED':
      return i18next.t('passphrase.lengthMessage', {
        label: i18next.t('create.passwordLabel'),
        min: 8,
      });
    case 'NOT_ALLOWED':
      return i18next.t('create.errorNotAllowed');
    case 'NETWORK_ERROR':
      return i18next.t('create.errorNetwork');
    case 'BAD_REQUEST':
    case 'INVALID_REQUEST':
      return i18next.t('create.errorBadRequest');
    default:
      return i18next.t('create.errorDefault');
  }
}

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

function ModeSelectorGrid({
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

function HowItWorks() {
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

function TrustModelHint() {
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

function QuickSharePasswordPanel({
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

function ActionFooter({
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

function useCopyLink(url: string) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [url]);
  return { copied, copy };
}

function CopyableLinkRow({
  label,
  url,
  testId,
  copyTestId,
  isManageLink = false,
}: {
  label: string;
  url: string;
  testId: string;
  copyTestId: string;
  isManageLink?: boolean;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyLink(url);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {isManageLink ? (
          <a
            className="flex-1 break-all rounded bg-muted/60 px-2 py-1.5 font-mono text-xs text-neon-cyan hover:underline"
            data-testid={testId}
            href={url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {url}
          </a>
        ) : (
          <span
            className="flex-1 break-all rounded bg-muted/60 px-2 py-1.5 font-mono text-xs text-neon-cyan"
            data-testid={testId}
          >
            {url}
          </span>
        )}
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          data-testid={copyTestId}
          onClick={() => void copy()}
          type="button"
        >
          {copied ? (
            <>
              <ClipboardCheck aria-hidden="true" className="size-3.5 text-neon-green" />
              {t('create.copiedButton')}
            </>
          ) : (
            <>
              <Copy aria-hidden="true" className="size-3.5" />
              {t('create.copyButton')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function SuccessSummary({
  createdProfile,
  links,
  onCreateAnother,
}: {
  createdProfile: SecurityProfile | null;
  links: CreatedLinks | null;
  onCreateAnother: () => void;
}) {
  const { t } = useTranslation();

  const profileLabelMap: Record<SecurityProfile, string> = useMemo(
    () => ({
      [SECURITY_PROFILE.QUICK]: t('profile.quick'),
      [SECURITY_PROFILE.SECURE]: t('profile.secure'),
    }),
    [t]
  );

  if (!createdProfile || !links) return null;

  return (
    <div
      className="space-y-5 rounded-xl border border-neon-green/30 bg-neon-green/5 p-5"
      data-testid="create-success-summary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="font-semibold text-neon-green">{t('create.successTitle')}</p>
          <p className="text-xs text-muted-foreground">
            {t('create.successModeLabel')}{' '}
            <span className="font-medium text-foreground">{profileLabelMap[createdProfile]}</span>
            {links.isPasswordMode ? (
              <span
                className="ml-2 inline-block rounded border border-neon-purple/40 bg-neon-purple/10 px-1.5 py-px text-xs font-semibold text-neon-purple"
                data-testid="create-password-mode-badge"
              >
                {t('create.passwordProtectedBadge')}
              </span>
            ) : null}
          </p>
        </div>
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          data-testid="create-another-button"
          onClick={onCreateAnother}
          type="button"
        >
          <PlusCircle aria-hidden="true" className="size-3.5" />
          {t('create.createAnother')}
        </button>
      </div>

      <div className="space-y-4">
        <CopyableLinkRow
          copyTestId="create-success-share-link-copy"
          label={t('create.shareLinkLabel')}
          testId="create-success-share-link"
          url={links.shareUrlWithFragment}
        />
        <StateNotice
          data-testid="create-success-share-link-warning"
          title={t('create.shareLinkWarningTitle')}
          tone="warning"
        >
          <p className="mt-1 text-sm text-neon-orange">
            <AlertTriangle aria-hidden="true" className="mr-1 inline size-4" />
            {t('create.shareLinkWarningBody')}
          </p>
        </StateNotice>
        <CopyableLinkRow
          copyTestId="create-success-manage-link-copy"
          isManageLink
          label={t('create.manageLinkLabel')}
          testId="create-success-manage-link"
          url={links.manageUrl}
        />
        <p className="text-xs text-muted-foreground" data-testid="create-success-expiry-hint">
          {t('create.expiryHint')}
        </p>
      </div>
    </div>
  );
}

interface RunCreateOptions {
  quickPassword: string;
  store: CreateStore;
  onError: (message: string) => void;
  onSuccess: (links: CreatedLinks) => void;
  onQuickPasswordClear: () => void;
}

async function runCreate({
  quickPassword,
  store,
  onError,
  onSuccess,
  onQuickPasswordClear,
}: RunCreateOptions): Promise<void> {
  // Read latest state at call time to avoid stale profile closure
  const { selectedProfile } = useCreateStore.getState();
  store.startCreateBegin();

  let result: Awaited<ReturnType<typeof cryptoOrchestrator.createChannel>>;
  try {
    result = await cryptoOrchestrator.createChannel({
      uuid: generateChannelUuid(),
      profile: selectedProfile,
      useCompatibilityMode: selectedProfile === SECURITY_PROFILE.QUICK,
      ...(selectedProfile === SECURITY_PROFILE.QUICK ? { softkeyPassphrase: quickPassword } : {}),
    });
  } catch {
    store.failCreateBegin('INTERNAL_ERROR');
    onError('Channel creation failed: INTERNAL_ERROR');
    return;
  }

  if (!result.ok) {
    store.failCreateBegin(result.error.code);
    onError(mapCreateError(result.error.code));
    return;
  }

  store.completeCreateBegin({ ok: true, creationOptions: {} });
  store.setCreatedProfile(selectedProfile);

  let manageUrl = result.data.manageUrl;
  if (selectedProfile === SECURITY_PROFILE.QUICK && result.data.wrappedPrivateKey) {
    const compact = serializeWrappedKeyCompact(result.data.wrappedPrivateKey);
    manageUrl = buildManageUrlWithFragment(manageUrl, compact);
  }

  onSuccess({
    shareUrlWithFragment: result.data.shareUrlWithFragment,
    manageUrl,
    isPasswordMode: selectedProfile === SECURITY_PROFILE.QUICK,
  });
  if (selectedProfile === SECURITY_PROFILE.QUICK) onQuickPasswordClear();
}

function useCreatePageLogic() {
  const store = useCreateStore();
  const [createdLinks, setCreatedLinks] = useState<CreatedLinks | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [quickPassword, setQuickPassword] = useState('');

  useEffect(() => {
    const support = detectWebAuthnSupport();
    store.setWebAuthnSupported(support.supported);
    store.setSelectedProfile(SECURITY_PROFILE.QUICK);
  }, [store.setWebAuthnSupported, store.setSelectedProfile]);

  const isQuickMode = store.selectedProfile === SECURITY_PROFILE.QUICK;
  const isSubmitting =
    store.createBegin.status === 'loading' || store.createFinish.status === 'loading';
  const canSubmit = isQuickMode
    ? hasRequiredPassphraseLength(quickPassword)
    : store.webAuthnSupported;

  function clearLocalFeedback(): void {
    setSubmitError(null);
    setCreatedLinks(null);
    store.setCreatedProfile(null);
  }

  function handleSelectProfile(profile: SecurityProfile): void {
    store.setSelectedProfile(profile);
    clearLocalFeedback();
  }

  function handleCreate(): void {
    if (isSubmitting || !canSubmit) return;
    clearLocalFeedback();
    void runCreate({
      quickPassword,
      store,
      onError: setSubmitError,
      onSuccess: setCreatedLinks,
      onQuickPasswordClear: () => setQuickPassword(''),
    });
  }

  function handleCreateAnother(): void {
    clearLocalFeedback();
  }

  return {
    state: store,
    createdLinks,
    submitError,
    quickPassword,
    isQuickMode,
    isSubmitting,
    canSubmit,
    handleSelectProfile,
    handleCreate,
    handleCreateAnother,
    handleQuickPasswordChange: (value: string) => {
      setQuickPassword(value);
      if (submitError) setSubmitError(null);
    },
  };
}

/**
 * Create page with Quick Share (password) and Secure Share (passkey) modes.
 */
export function CreatePage(): ReactElement {
  const { t } = useTranslation();
  const logic = useCreatePageLogic();

  return (
    <PageCard data-testid="page-create" tone="purple">
      <PageCardHeader>
        <div className="flex items-center justify-between gap-3">
          <PageCardTitle asChild className="text-primary">
            <h2>{t('create.title')}</h2>
          </PageCardTitle>
          <RoleBadge party="sender" />
        </div>
        <PageCardDescription>{t('create.description')}</PageCardDescription>
      </PageCardHeader>
      <PageCardContent aria-busy={logic.isSubmitting} className="space-y-6">
        {logic.createdLinks ? (
          <SuccessSummary
            createdProfile={logic.state.createdProfile}
            links={logic.createdLinks}
            onCreateAnother={logic.handleCreateAnother}
          />
        ) : (
          <>
            <HowItWorks />
            <ModeSelectorGrid
              onSelect={logic.handleSelectProfile}
              selected={logic.state.selectedProfile}
              webAuthnSupported={logic.state.webAuthnSupported}
            />
            <TrustModelHint />
            {logic.isQuickMode ? (
              <QuickSharePasswordPanel
                onPasswordChange={logic.handleQuickPasswordChange}
                password={logic.quickPassword}
              />
            ) : null}
            <ActionFooter
              disabled={logic.isSubmitting || !logic.canSubmit}
              isLoading={logic.isSubmitting}
              onCreate={logic.handleCreate}
            />
            {logic.submitError ? (
              <StateNotice
                autoFocusOnMount
                data-testid="create-submit-error"
                id="create-submit-error"
                tone="error"
              >
                {logic.submitError}
              </StateNotice>
            ) : null}
          </>
        )}
      </PageCardContent>
    </PageCard>
  );
}
