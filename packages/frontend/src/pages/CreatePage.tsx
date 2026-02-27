import { SECURITY_PROFILE, type SecurityProfile } from '@zerolink/shared';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { SecurityProfileCard } from '../components/create/security-profile-card';
import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  RoleBadge,
  StateNotice,
} from '../components/layout';
import { Button } from '../components/ui/button';
import { cryptoOrchestrator } from '../crypto/orchestrator';
import { detectWebAuthnSupport } from '../crypto/webauthn';
import { generateChannelUuid } from '../lib/channel-uuid';
import { useCreateStore } from '../stores/create-store';

const profileOrder: SecurityProfile[] = [
  SECURITY_PROFILE.STANDARD,
  SECURITY_PROFILE.STRICT,
  SECURITY_PROFILE.HARDWARE_ONLY,
];

const profileLabelMap: Record<SecurityProfile, string> = {
  [SECURITY_PROFILE.STANDARD]: 'Standard',
  [SECURITY_PROFILE.STRICT]: 'Strict',
  [SECURITY_PROFILE.HARDWARE_ONLY]: 'Hardware-Only',
};

interface CreatedLinks {
  shareUrlWithFragment: string;
  manageUrl: string;
}

const FALLBACK_UNAVAILABLE_MESSAGE =
  'Compatibility mode fallback is not implemented yet in this build.';

function mapCreateError(code: string): string {
  switch (code) {
    case 'FALLBACK_REQUIRED':
      return FALLBACK_UNAVAILABLE_MESSAGE;
    case 'PROFILE_BLOCKED':
      return 'This security profile requires WebAuthn support in your environment.';
    case 'NETWORK_ERROR':
      return 'Network error while creating channel. Please retry.';
    case 'BAD_REQUEST':
    case 'INVALID_REQUEST':
      return 'Create request was rejected. Please retry.';
    default:
      return `Channel creation failed: ${code}`;
  }
}

function ProfileSelectionGrid({
  selectedProfile,
  onSelectProfile,
}: {
  selectedProfile: SecurityProfile;
  onSelectProfile: (profile: SecurityProfile) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">Select Security Level</h3>
      <div className="grid gap-4 md:grid-cols-3">
        {profileOrder.map((profile) => (
          <SecurityProfileCard
            key={profile}
            onSelect={onSelectProfile}
            profile={profile}
            selected={selectedProfile === profile}
          />
        ))}
      </div>
    </section>
  );
}

function WebAuthnWarning({ strictOrHardwareBlocked }: { strictOrHardwareBlocked: boolean }) {
  if (!strictOrHardwareBlocked) return null;

  return (
    <StateNotice
      data-testid="create-webauthn-blocked-warning"
      title="Hardware authentication is not available in this environment."
      tone="warning"
    >
      <p className="text-neon-orange">
        Strict and Hardware-Only profiles require WebAuthn support.
      </p>
    </StateNotice>
  );
}

function CompatibilityPanel({
  compatibilityAccepted,
  setCompatibilityAccepted,
  onContinue,
  onCancel,
  loading,
}: {
  compatibilityAccepted: boolean;
  setCompatibilityAccepted: (accepted: boolean) => void;
  onContinue: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div
      className="space-y-3 rounded-xl border border-neon-orange/35 bg-neon-orange/10 p-4 text-sm"
      data-testid="create-compatibility-panel"
    >
      <p className="font-medium text-foreground">Compatibility Mode (Lower Security)</p>
      <p>
        Compatibility mode fallback is not implemented in this build. Use a WebAuthn-capable
        environment to create channels.
      </p>
      <label className="flex items-start gap-2">
        <input
          checked={compatibilityAccepted}
          data-testid="create-compatibility-checkbox"
          onChange={(event) => setCompatibilityAccepted(event.target.checked)}
          type="checkbox"
        />
        <span>
          I understand that compatibility mode is currently unavailable and want to attempt anyway.
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="create-compatibility-continue"
          disabled={!compatibilityAccepted || loading}
          onClick={onContinue}
          size="sm"
          type="button"
        >
          Continue
        </Button>
        <Button
          data-testid="create-compatibility-cancel"
          onClick={onCancel}
          size="sm"
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
      </div>
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
        {disabled ? 'Creating...' : 'Create Secure Channel'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Integration mode: create flow calls API + WebAuthn through orchestrator.
      </p>
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
      <p>
        Selected profile: <span className="font-semibold">{profileLabelMap[createdProfile]}</span>
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

  useEffect(() => {
    const support = detectWebAuthnSupport();
    store.setWebAuthnSupported(support.supported);
  }, [store.setWebAuthnSupported]);

  const strictOrHardwareBlocked =
    !store.webAuthnSupported && store.selectedProfile !== SECURITY_PROFILE.STANDARD;
  const compatibilityAvailable =
    !store.webAuthnSupported && store.selectedProfile === SECURITY_PROFILE.STANDARD;
  const isSubmitting =
    store.createBegin.status === 'loading' || store.createFinish.status === 'loading';

  function clearLocalFeedback(): void {
    setSubmitError(null);
    setCreatedLinks(null);
    store.setCreatedProfile(null);
  }

  function showFallbackUnavailableError(): void {
    setSubmitError(FALLBACK_UNAVAILABLE_MESSAGE);
    setCreatedLinks(null);
    store.setCreatedProfile(null);
    store.setShowCompatibilityConfirm(false);
    store.setCompatibilityAccepted(false);
  }

  function handleSelectProfile(profile: SecurityProfile): void {
    store.setSelectedProfile(profile);
    clearLocalFeedback();
  }

  async function runCreate(): Promise<void> {
    if (compatibilityAvailable) {
      showFallbackUnavailableError();
      return;
    }

    clearLocalFeedback();
    store.startCreateBegin();

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.createChannel>>;
    try {
      result = await cryptoOrchestrator.createChannel({
        uuid: generateChannelUuid(),
        profile: store.selectedProfile,
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
    });
    store.setShowCompatibilityConfirm(false);
    store.setCompatibilityAccepted(false);
  }

  function handleCreate(): void {
    if (strictOrHardwareBlocked || isSubmitting) return;

    if (compatibilityAvailable) {
      if (!store.showCompatibilityConfirm) {
        store.setShowCompatibilityConfirm(true);
        return;
      }
      if (!store.compatibilityAccepted) return;
      showFallbackUnavailableError();
      return;
    }

    void runCreate();
  }

  function handleCompatibilityCancel(): void {
    store.setShowCompatibilityConfirm(false);
    store.setCompatibilityAccepted(false);
    setSubmitError(null);
  }

  function handleCompatibilityContinue(): void {
    if (!store.compatibilityAccepted || isSubmitting) return;

    if (compatibilityAvailable) {
      showFallbackUnavailableError();
      return;
    }

    void runCreate();
  }

  return {
    state: store,
    createdLinks,
    submitError,
    strictOrHardwareBlocked,
    compatibilityAvailable,
    isSubmitting,
    handleSelectProfile,
    handleCreate,
    handleCompatibilityCancel,
    handleCompatibilityContinue,
  };
}

/**
 * Create page integrated with store + orchestrator create flow.
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
          Zero-knowledge channel creation with security profile gating and WebAuthn integration.
        </PageCardDescription>
      </PageCardHeader>
      <PageCardContent aria-busy={logic.isSubmitting} className="space-y-6">
        <ProfileSelectionGrid
          onSelectProfile={logic.handleSelectProfile}
          selectedProfile={logic.state.selectedProfile}
        />
        <WebAuthnWarning strictOrHardwareBlocked={logic.strictOrHardwareBlocked} />
        {logic.state.showCompatibilityConfirm && logic.compatibilityAvailable ? (
          <CompatibilityPanel
            compatibilityAccepted={logic.state.compatibilityAccepted}
            loading={logic.isSubmitting}
            onCancel={logic.handleCompatibilityCancel}
            onContinue={logic.handleCompatibilityContinue}
            setCompatibilityAccepted={logic.state.setCompatibilityAccepted}
          />
        ) : null}
        <ActionFooter disabled={logic.isSubmitting} onCreate={logic.handleCreate} />
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
