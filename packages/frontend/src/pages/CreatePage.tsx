import { SECURITY_PROFILE, type SecurityProfile } from '@zerolink/shared';
import { ChevronRight, Zap } from 'lucide-react';
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
import { PassphraseInput } from '../components/lock/passphrase-input';
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
  isCompatibilityMode: boolean;
}

const FALLBACK_UNAVAILABLE_MESSAGE =
  'Compatibility mode fallback is not implemented yet in this build.';

function mapCreateError(code: string): string {
  switch (code) {
    case 'FALLBACK_REQUIRED':
      return FALLBACK_UNAVAILABLE_MESSAGE;
    case 'PROFILE_BLOCKED':
      return 'This security profile requires WebAuthn support in your environment.';
    case 'PASSPHRASE_REQUIRED':
      return 'Compatibility mode passphrase is required.';
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

function DowngradeDialog({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div
      className="space-y-3 rounded-xl border border-neon-blue/35 bg-neon-blue/10 p-4 text-sm"
      data-testid="create-downgrade-dialog"
    >
      <p className="font-medium text-foreground">Hardware Attestation Unavailable</p>
      <p>
        Your authenticator provided a valid credential but does not support hardware attestation
        required for the Hardware-Only profile.
      </p>
      <p>Would you like to continue using the Strict profile instead?</p>
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="create-downgrade-confirm"
          disabled={loading}
          onClick={onConfirm}
          size="sm"
          type="button"
        >
          <ChevronRight aria-hidden="true" className="size-3.5" />
          Continue with Strict
        </Button>
        <Button
          data-testid="create-downgrade-cancel"
          disabled={loading}
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

function CompatibilityPanel({
  compatibilityAccepted,
  setCompatibilityAccepted,
  passphrase,
  onPassphraseChange,
  onContinue,
  onCancel,
  loading,
}: {
  compatibilityAccepted: boolean;
  setCompatibilityAccepted: (accepted: boolean) => void;
  passphrase: string;
  onPassphraseChange: (value: string) => void;
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
        Hardware authentication is unavailable. Compatibility mode will generate a software key
        stored in your browser to manage this channel.
      </p>
      <PassphraseInput
        inputId="create-compatibility-passphrase"
        label="Compatibility passphrase"
        onChange={onPassphraseChange}
        placeholder="Set compatibility passphrase"
        showStrength
        value={passphrase}
      />
      <label className="flex items-start gap-2">
        <input
          checked={compatibilityAccepted}
          data-testid="create-compatibility-checkbox"
          onChange={(event) => setCompatibilityAccepted(event.target.checked)}
          type="checkbox"
        />
        <span>
          I understand this provides lower security than hardware authentication and wish to
          proceed.
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="create-compatibility-continue"
          disabled={!compatibilityAccepted || passphrase.trim().length === 0 || loading}
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
        {disabled ? (
          'Creating...'
        ) : (
          <>
            <Zap aria-hidden="true" className="size-4" />
            Create Secure Channel
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
      {links.isCompatibilityMode ? (
        <div
          className="mb-2 inline-block rounded-md border border-neon-orange/40 bg-neon-orange/10 px-2 py-0.5 text-xs font-semibold text-neon-orange"
          data-testid="create-compatibility-badge"
        >
          Compatibility Mode (Lower Security)
        </div>
      ) : null}
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
  const [compatibilityPassphrase, setCompatibilityPassphrase] = useState('');
  const [showDowngradeDialog, setShowDowngradeDialog] = useState(false);

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
    setShowDowngradeDialog(false);
  }

  function resetCompatibilityPassphrase(): void {
    setCompatibilityPassphrase('');
  }

  function _showFallbackUnavailableError(): void {
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
    const latestState = useCreateStore.getState();
    clearLocalFeedback();
    store.startCreateBegin();

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.createChannel>>;
    try {
      result = await cryptoOrchestrator.createChannel({
        uuid: generateChannelUuid(),
        profile: latestState.selectedProfile,
        useCompatibilityMode: latestState.compatibilityAccepted,
        ...(latestState.compatibilityAccepted
          ? { softkeyPassphrase: compatibilityPassphrase }
          : {}),
      });
    } catch {
      store.failCreateBegin('INTERNAL_ERROR');
      setSubmitError('Channel creation failed: INTERNAL_ERROR');
      return;
    }

    if (!result.ok) {
      if (result.error.code === 'ATTESTATION_UNVERIFIABLE') {
        store.failCreateBegin('ATTESTATION_UNVERIFIABLE');
        setShowDowngradeDialog(true);
        return;
      }

      store.failCreateBegin(result.error.code);
      setSubmitError(mapCreateError(result.error.code));
      return;
    }

    store.completeCreateBegin({ ok: true, creationOptions: {} });
    store.setCreatedProfile(store.selectedProfile);
    setCreatedLinks({
      shareUrlWithFragment: result.data.shareUrlWithFragment,
      manageUrl: result.data.manageUrl,
      isCompatibilityMode: store.compatibilityAccepted,
    });
    store.setShowCompatibilityConfirm(false);
    store.setCompatibilityAccepted(false);
    resetCompatibilityPassphrase();
    setShowDowngradeDialog(false);
  }

  function handleCreate(): void {
    if (strictOrHardwareBlocked || isSubmitting) return;

    if (compatibilityAvailable) {
      if (!store.showCompatibilityConfirm) {
        store.setShowCompatibilityConfirm(true);
        return;
      }
      if (!store.compatibilityAccepted || compatibilityPassphrase.trim().length === 0) return;
    }

    void runCreate();
  }

  function handleCompatibilityCancel(): void {
    store.setShowCompatibilityConfirm(false);
    store.setCompatibilityAccepted(false);
    resetCompatibilityPassphrase();
    setSubmitError(null);
  }

  function handleCompatibilityContinue(): void {
    if (!store.compatibilityAccepted || compatibilityPassphrase.trim().length === 0 || isSubmitting)
      return;

    void runCreate();
  }

  function handleDowngradeConfirm(): void {
    store.setSelectedProfile(SECURITY_PROFILE.STRICT);
    setShowDowngradeDialog(false);
    void runCreate();
  }

  function handleDowngradeCancel(): void {
    setShowDowngradeDialog(false);
    setSubmitError('Creation cancelled due to attestation failure.');
  }

  return {
    state: store,
    createdLinks,
    submitError,
    compatibilityPassphrase,
    showDowngradeDialog,
    strictOrHardwareBlocked,
    compatibilityAvailable,
    isSubmitting,
    handleSelectProfile,
    handleCreate,
    handleCompatibilityCancel,
    handleCompatibilityContinue,
    handleDowngradeConfirm,
    handleDowngradeCancel,
    handleCompatibilityPassphraseChange: (value: string) => {
      setCompatibilityPassphrase(value);
      if (submitError) {
        setSubmitError(null);
      }
    },
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
        {logic.showDowngradeDialog ? (
          <DowngradeDialog
            loading={logic.isSubmitting}
            onCancel={logic.handleDowngradeCancel}
            onConfirm={logic.handleDowngradeConfirm}
          />
        ) : null}
        {logic.state.showCompatibilityConfirm && logic.compatibilityAvailable ? (
          <CompatibilityPanel
            compatibilityAccepted={logic.state.compatibilityAccepted}
            loading={logic.isSubmitting}
            onCancel={logic.handleCompatibilityCancel}
            onContinue={logic.handleCompatibilityContinue}
            onPassphraseChange={logic.handleCompatibilityPassphraseChange}
            passphrase={logic.compatibilityPassphrase}
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
