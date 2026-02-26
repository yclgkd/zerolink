import { SECURITY_PROFILE, type SecurityProfile } from '@zerolink/shared';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';

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

export function CreatePage(): ReactElement {
  const [selectedProfile, setSelectedProfile] = useState<SecurityProfile>(
    SECURITY_PROFILE.STANDARD
  );
  const [showCompatibilityConfirm, setShowCompatibilityConfirm] = useState(false);
  const [compatibilityAccepted, setCompatibilityAccepted] = useState(false);
  const [createdProfile, setCreatedProfile] = useState<SecurityProfile | null>(null);
  const webAuthnSupported = useMemo(
    () => typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined',
    []
  );

  const strictOrHardwareBlocked =
    !webAuthnSupported && selectedProfile !== SECURITY_PROFILE.STANDARD;
  const compatibilityAvailable =
    !webAuthnSupported && selectedProfile === SECURITY_PROFILE.STANDARD;

  function resetTransientState(): void {
    setShowCompatibilityConfirm(false);
    setCompatibilityAccepted(false);
    setCreatedProfile(null);
  }

  function handleSelectProfile(profile: SecurityProfile): void {
    setSelectedProfile(profile);
    resetTransientState();
  }

  function completeCreateFlow(): void {
    setCreatedProfile(selectedProfile);
    setShowCompatibilityConfirm(false);
  }

  function handleCreate(): void {
    if (strictOrHardwareBlocked) {
      return;
    }

    if (!compatibilityAvailable) {
      completeCreateFlow();
      return;
    }

    if (!showCompatibilityConfirm) {
      setShowCompatibilityConfirm(true);
      return;
    }

    if (!compatibilityAccepted) {
      return;
    }

    completeCreateFlow();
  }

  function handleCompatibilityCancel(): void {
    setShowCompatibilityConfirm(false);
    setCompatibilityAccepted(false);
  }

  function handleCompatibilityContinue(): void {
    if (!compatibilityAccepted) {
      return;
    }

    completeCreateFlow();
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
          Zero-knowledge channel creation UI with profile selection and compatibility fallback.
        </PageCardDescription>
      </PageCardHeader>
      <PageCardContent className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">Select Security Level</h3>
          <div className="grid gap-4 md:grid-cols-3">
            {profileOrder.map((profile) => (
              <SecurityProfileCard
                key={profile}
                onSelect={handleSelectProfile}
                profile={profile}
                selected={selectedProfile === profile}
              />
            ))}
          </div>
        </section>

        {strictOrHardwareBlocked ? (
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
        ) : null}

        {showCompatibilityConfirm && compatibilityAvailable ? (
          <div
            className="space-y-3 rounded-xl border border-neon-orange/35 bg-neon-orange/10 p-4 text-sm"
            data-testid="create-compatibility-panel"
          >
            <p className="font-medium text-foreground">Compatibility Mode (Lower Security)</p>
            <p>
              Standard profile can continue without WebAuthn, but this reduces authentication
              guarantees.
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
                disabled={!compatibilityAccepted}
                onClick={handleCompatibilityContinue}
                size="sm"
                type="button"
              >
                Continue
              </Button>
              <Button
                data-testid="create-compatibility-cancel"
                onClick={handleCompatibilityCancel}
                size="sm"
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button data-testid="create-submit-button" onClick={handleCreate} type="button">
            Create Secure Channel
          </Button>
          <p className="text-xs text-muted-foreground">
            UI-only mode: no WebAuthn ceremony or backend request is executed in this task.
          </p>
        </div>

        {createdProfile ? (
          <div
            className="space-y-1 rounded-xl border border-neon-cyan/35 bg-neon-cyan/10 p-4 text-sm text-foreground"
            data-testid="create-success-summary"
          >
            <p className="font-medium">Mock channel created (UI-only).</p>
            <p>
              Selected profile:{' '}
              <span className="font-semibold">{profileLabelMap[createdProfile]}</span>
            </p>
          </div>
        ) : null}
      </PageCardContent>
    </PageCard>
  );
}
