import { SECURITY_PROFILE, type SecurityProfile } from '@zerolink/shared';
import { Lock, Shield, Zap } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

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
import { cryptoOrchestrator } from '../crypto/orchestrator';
import { detectWebAuthnSupport } from '../crypto/webauthn';
import { generateChannelUuid } from '../lib/channel-uuid';
import { cn } from '../lib/utils';
import { useCreateStore } from '../stores/create-store';

const profileLabelMap: Record<SecurityProfile, string> = {
  [SECURITY_PROFILE.QUICK]: 'Quick Share',
  [SECURITY_PROFILE.SECURE]: 'Secure Share',
  // Legacy labels for existing channels
  [SECURITY_PROFILE.STANDARD]: 'Standard',
  [SECURITY_PROFILE.STRICT]: 'Strict',
  [SECURITY_PROFILE.HARDWARE_ONLY]: 'Hardware-Only',
};

interface CreatedLinks {
  shareUrlWithFragment: string;
  manageUrl: string;
  isPasswordMode: boolean;
}

function mapCreateError(code: string): string {
  switch (code) {
    case 'PROFILE_BLOCKED':
      return 'Secure Share requires WebAuthn support in your environment.';
    case 'PASSPHRASE_REQUIRED':
      return 'Please enter a password for Quick Share.';
    case 'NOT_ALLOWED':
      return 'Passkey prompt was cancelled or denied. Please try again.';
    case 'NETWORK_ERROR':
      return 'Network error while creating channel. Please retry.';
    case 'BAD_REQUEST':
    case 'INVALID_REQUEST':
      return 'Create request was rejected. Please retry.';
    default:
      return `Channel creation failed: ${code}`;
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
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">Choose Share Mode</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <ModeCard
          data-testid="mode-card-quick"
          description="Password-protected — no passkey needed. Works in any browser."
          icon={Lock}
          onClick={() => onSelect(SECURITY_PROFILE.QUICK)}
          selected={selected === SECURITY_PROFILE.QUICK}
          title="Quick Share"
        />
        <ModeCard
          data-testid="mode-card-secure"
          description={
            webAuthnSupported
              ? 'Passkey-protected — strongest security with user verification.'
              : 'Requires WebAuthn support (not available in this environment).'
          }
          icon={Shield}
          onClick={() => {
            if (webAuthnSupported) onSelect(SECURITY_PROFILE.SECURE);
          }}
          selected={selected === SECURITY_PROFILE.SECURE}
          title="Secure Share"
        />
      </div>
      {!webAuthnSupported ? (
        <StateNotice
          data-testid="create-webauthn-blocked-warning"
          title="WebAuthn is not available in this environment."
          tone="warning"
        >
          <p className="text-neon-orange">Secure Share is disabled. Use Quick Share instead.</p>
        </StateNotice>
      ) : null}
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
  return (
    <div
      className="space-y-3 rounded-xl border border-neon-purple/35 bg-neon-purple/10 p-4 text-sm"
      data-testid="quick-share-password-panel"
    >
      <p className="font-medium text-foreground">Set a Quick Share Password</p>
      <p className="text-muted-foreground">
        This password protects your channel management key. Choose something strong — it cannot be
        recovered if lost.
      </p>
      <PassphraseInput
        inputId="create-quick-password"
        label="Channel password"
        onChange={onPasswordChange}
        placeholder="Enter a strong password"
        showStrength
        value={password}
      />
    </div>
  );
}

function ActionFooter({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        data-testid="create-submit-button"
        disabled={disabled}
        onClick={onCreate}
        type="button"
      >
        {disabled ? (
          'Creating...'
        ) : (
          <>
            <Zap aria-hidden="true" className="size-4" />
            Create Channel
          </>
        )}
      </Button>
    </div>
  );
}

function SuccessSummary({
  createdProfile,
  links,
}: {
  createdProfile: SecurityProfile | null;
  links: CreatedLinks | null;
}) {
  if (!createdProfile || !links) return null;

  return (
    <StateNotice
      data-testid="create-success-summary"
      title="Secure channel created."
      tone="success"
    >
      {links.isPasswordMode ? (
        <div
          className="mb-2 inline-block rounded-md border border-neon-purple/40 bg-neon-purple/10 px-2 py-0.5 text-xs font-semibold text-neon-purple"
          data-testid="create-password-mode-badge"
        >
          Quick Share (Password)
        </div>
      ) : null}
      <p>
        Mode: <span className="font-semibold">{profileLabelMap[createdProfile]}</span>
      </p>
      <p>
        Share link:{' '}
        <a
          className="text-primary underline"
          data-testid="create-success-share-link"
          href={links.shareUrlWithFragment}
        >
          {links.shareUrlWithFragment}
        </a>
      </p>
      <p>
        Manage link:{' '}
        <a
          className="text-primary underline"
          data-testid="create-success-manage-link"
          href={links.manageUrl}
        >
          {links.manageUrl}
        </a>
      </p>
    </StateNotice>
  );
}

function useCreatePageLogic() {
  const store = useCreateStore();
  const [createdLinks, setCreatedLinks] = useState<CreatedLinks | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [quickPassword, setQuickPassword] = useState('');

  useEffect(() => {
    const support = detectWebAuthnSupport();
    store.setWebAuthnSupported(support.supported);
    // Default to Secure if WebAuthn available, otherwise Quick
    if (support.supported) {
      store.setSelectedProfile(SECURITY_PROFILE.SECURE);
    } else {
      store.setSelectedProfile(SECURITY_PROFILE.QUICK);
    }
  }, [store.setWebAuthnSupported, store.setSelectedProfile]);

  const isQuickMode = store.selectedProfile === SECURITY_PROFILE.QUICK;
  const isSubmitting =
    store.createBegin.status === 'loading' || store.createFinish.status === 'loading';
  const canSubmit = isQuickMode ? quickPassword.trim().length > 0 : store.webAuthnSupported;

  function clearLocalFeedback(): void {
    setSubmitError(null);
    setCreatedLinks(null);
    store.setCreatedProfile(null);
  }

  function handleSelectProfile(profile: SecurityProfile): void {
    store.setSelectedProfile(profile);
    clearLocalFeedback();
  }

  async function runCreate(): Promise<void> {
    const latestState = useCreateStore.getState();
    clearLocalFeedback();
    store.startCreateBegin();

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.createChannel>>;
    try {
      result = await cryptoOrchestrator.createChannel({
        uuid: generateChannelUuid(),
        profile: latestState.selectedProfile,
        useCompatibilityMode: latestState.selectedProfile === SECURITY_PROFILE.QUICK,
        ...(latestState.selectedProfile === SECURITY_PROFILE.QUICK
          ? { softkeyPassphrase: quickPassword }
          : {}),
      });
    } catch {
      store.failCreateBegin('INTERNAL_ERROR');
      setSubmitError('Channel creation failed: INTERNAL_ERROR');
      return;
    }

    if (!result.ok) {
      store.failCreateBegin(result.error.code);
      setSubmitError(mapCreateError(result.error.code));
      return;
    }

    store.completeCreateBegin({ ok: true, creationOptions: {} });
    store.setCreatedProfile(store.selectedProfile);
    setCreatedLinks({
      shareUrlWithFragment: result.data.shareUrlWithFragment,
      manageUrl: result.data.manageUrl,
      isPasswordMode: store.selectedProfile === SECURITY_PROFILE.QUICK,
    });
    if (isQuickMode) setQuickPassword('');
  }

  function handleCreate(): void {
    if (isSubmitting || !canSubmit) return;
    void runCreate();
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
  const logic = useCreatePageLogic();

  return (
    <PageCard data-testid="page-create" tone="purple">
      <PageCardHeader>
        <div className="flex items-center justify-between gap-3">
          <PageCardTitle asChild className="text-primary">
            <h2>Create Secure Channel</h2>
          </PageCardTitle>
          <RoleBadge party="sender" />
        </div>
        <PageCardDescription>
          Zero-knowledge encrypted delivery. Choose Quick Share (password) or Secure Share
          (passkey).
        </PageCardDescription>
      </PageCardHeader>
      <PageCardContent aria-busy={logic.isSubmitting} className="space-y-6">
        <ModeSelectorGrid
          onSelect={logic.handleSelectProfile}
          selected={logic.state.selectedProfile}
          webAuthnSupported={logic.state.webAuthnSupported}
        />
        {logic.isQuickMode ? (
          <QuickSharePasswordPanel
            onPasswordChange={logic.handleQuickPasswordChange}
            password={logic.quickPassword}
          />
        ) : null}
        <ActionFooter
          disabled={logic.isSubmitting || !logic.canSubmit}
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
        <SuccessSummary createdProfile={logic.state.createdProfile} links={logic.createdLinks} />
      </PageCardContent>
    </PageCard>
  );
}
