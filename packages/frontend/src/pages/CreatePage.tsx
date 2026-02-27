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
    <div
      className="space-y-2 rounded-xl border border-neon-orange/40 bg-neon-orange/10 p-4 text-sm"
      data-testid="create-webauthn-blocked-warning"
    >
      <p className="font-medium text-foreground">
        Hardware authentication is not available in this environment.
      </p>
      <p className="text-neon-orange">
        Strict and Hardware-Only profiles require WebAuthn support.
      </p>
    </div>
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
        <span>I understand the risk and want to continue in Compatibility Mode.</span>
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
    <div
      className="space-y-2 rounded-xl border border-neon-cyan/35 bg-neon-cyan/10 p-4 text-sm text-foreground"
      data-testid="create-success-summary"
    >
      <p className="font-medium">Secure channel created.</p>
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
    </div>
  );
}

/**
 * Create page integrated with store + orchestrator create flow.
 */
export function CreatePage(): ReactElement {
  const {
    selectedProfile,
    webAuthnSupported,
    showCompatibilityConfirm,
    compatibilityAccepted,
    createdProfile,
    createBegin,
    createFinish,
    setSelectedProfile,
    setWebAuthnSupported,
    setShowCompatibilityConfirm,
    setCompatibilityAccepted,
    setCreatedProfile,
  } = useCreateStore();

  const [createdLinks, setCreatedLinks] = useState<CreatedLinks | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const support = detectWebAuthnSupport();
    setWebAuthnSupported(support.supported);
  }, [setWebAuthnSupported]);

  const strictOrHardwareBlocked =
    !webAuthnSupported && selectedProfile !== SECURITY_PROFILE.STANDARD;
  const compatibilityAvailable =
    !webAuthnSupported && selectedProfile === SECURITY_PROFILE.STANDARD;
  const isSubmitting =
    isCreating || createBegin.status === 'loading' || createFinish.status === 'loading';

  function clearLocalFeedback(): void {
    setSubmitError(null);
    setCreatedLinks(null);
    setCreatedProfile(null);
  }

  function showFallbackUnavailableError(): void {
    setSubmitError(FALLBACK_UNAVAILABLE_MESSAGE);
    setCreatedLinks(null);
    setCreatedProfile(null);
    setShowCompatibilityConfirm(false);
    setCompatibilityAccepted(false);
  }

  function handleSelectProfile(profile: SecurityProfile): void {
    setSelectedProfile(profile);
    clearLocalFeedback();
  }

  async function runCreate(): Promise<void> {
    if (compatibilityAvailable) {
      showFallbackUnavailableError();
      return;
    }

    clearLocalFeedback();
    setIsCreating(true);
    let result: Awaited<ReturnType<typeof cryptoOrchestrator.createChannel>>;

    try {
      result = await cryptoOrchestrator.createChannel({
        uuid: generateChannelUuid(),
        profile: selectedProfile,
      });
    } catch {
      setSubmitError('Channel creation failed: INTERNAL_ERROR');
      return;
    } finally {
      setIsCreating(false);
    }

    if (!result.ok) {
      setSubmitError(mapCreateError(result.error.code));
      return;
    }

    setCreatedProfile(selectedProfile);
    setCreatedLinks({
      shareUrlWithFragment: result.data.shareUrlWithFragment,
      manageUrl: result.data.manageUrl,
    });
    setShowCompatibilityConfirm(false);
    setCompatibilityAccepted(false);
  }

  function handleCreate(): void {
    if (strictOrHardwareBlocked || isSubmitting) {
      return;
    }

    if (compatibilityAvailable && !showCompatibilityConfirm) {
      setShowCompatibilityConfirm(true);
      return;
    }

    if (compatibilityAvailable && showCompatibilityConfirm && !compatibilityAccepted) {
      return;
    }

    if (compatibilityAvailable) {
      showFallbackUnavailableError();
      return;
    }

    void runCreate();
  }

  function handleCompatibilityCancel(): void {
    setShowCompatibilityConfirm(false);
    setCompatibilityAccepted(false);
    setSubmitError(null);
  }

  function handleCompatibilityContinue(): void {
    if (!compatibilityAccepted || isSubmitting) return;

    if (compatibilityAvailable) {
      showFallbackUnavailableError();
      return;
    }

    void runCreate();
  }

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
      <PageCardContent className="space-y-6">
        <ProfileSelectionGrid
          onSelectProfile={handleSelectProfile}
          selectedProfile={selectedProfile}
        />
        <WebAuthnWarning strictOrHardwareBlocked={strictOrHardwareBlocked} />
        {showCompatibilityConfirm && compatibilityAvailable ? (
          <CompatibilityPanel
            compatibilityAccepted={compatibilityAccepted}
            loading={isSubmitting}
            onCancel={handleCompatibilityCancel}
            onContinue={handleCompatibilityContinue}
            setCompatibilityAccepted={setCompatibilityAccepted}
          />
        ) : null}
        <ActionFooter disabled={isSubmitting} onCreate={handleCreate} />
        {submitError ? (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            data-testid="create-submit-error"
          >
            {submitError}
          </div>
        ) : null}
        <SuccessSummary createdProfile={createdProfile} links={createdLinks} />
      </PageCardContent>
    </PageCard>
  );
}
