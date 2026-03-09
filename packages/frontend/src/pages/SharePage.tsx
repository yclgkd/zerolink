import { CHANNEL_STATE } from '@zerolink/shared';
import type { ReactElement } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  RoleBadge,
} from '../components/layout';
import {
  DeliveredStep,
  LoadingStep,
  LockedStep,
  LockStep,
  OnboardingStep,
  StepIndicator,
  UnavailableStep,
} from '../components/share/share-steps';
import {
  usePublicShareState,
  useSharePageDecryptLogic,
  useSharePageLockLogic,
} from '../features/share/share-logic';

function SharePageHeader() {
  return (
    <PageCardHeader>
      <div className="flex items-center justify-between gap-3">
        <PageCardTitle asChild className="text-primary">
          <h2>Receiver Setup</h2>
        </PageCardTitle>
        <RoleBadge party="receiver" />
      </div>
      <PageCardDescription>
        The sender already created this channel. Set your own passphrase here to generate your
        receiver key and lock the channel on this device.
      </PageCardDescription>
    </PageCardHeader>
  );
}

function UuidDisplay({ uuid }: { uuid?: string | undefined }) {
  return (
    <p className="text-xs text-muted-foreground">
      Channel ID:{' '}
      <code
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground"
        data-testid="share-uuid"
      >
        {uuid ?? '(missing)'}
      </code>
    </p>
  );
}

const LOCK_FLOW_STEPS = ['Receiver intro', 'Your passphrase', 'Ready for delivery'] as const;

const LOCK_STEP_INDEX: Record<'onboarding' | 'lock' | 'locked', number> = {
  onboarding: 1,
  lock: 2,
  locked: 3,
};

/**
 * Receiver page integrating lock flow and delivered decryption flow with orchestrator.
 */
export function SharePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();
  const location = useLocation();
  const publicState = usePublicShareState(uuid);
  const isUnavailable = !publicState.isPublicStatusLoading && publicState.isUnavailable;
  const lockLogic = useSharePageLockLogic(uuid, location.hash);
  const isDeliveredState =
    !publicState.isPublicStatusLoading && publicState.channelState === CHANNEL_STATE.DELIVERED;
  const decryptLogic = useSharePageDecryptLogic(uuid, isDeliveredState);
  const isPageBusy =
    publicState.isPublicStatusLoading || lockLogic.lockPending || decryptLogic.decryptPending;

  return (
    <PageCard data-testid="page-share" tone="cyan">
      <SharePageHeader />
      <PageCardContent aria-busy={isPageBusy} className="space-y-6">
        <UuidDisplay uuid={uuid} />

        {publicState.isPublicStatusLoading ? <LoadingStep /> : null}

        {isUnavailable ? <UnavailableStep /> : null}

        {!publicState.isPublicStatusLoading &&
        !publicState.isUnavailable &&
        publicState.channelState === CHANNEL_STATE.WAITING ? (
          <>
            {lockLogic.store.step !== 'locked' ? (
              <StepIndicator
                current={LOCK_STEP_INDEX[lockLogic.store.step]}
                labels={LOCK_FLOW_STEPS}
                total={3}
              />
            ) : null}
            {lockLogic.store.step === 'onboarding' ? (
              <OnboardingStep onContinue={() => lockLogic.store.setStep('lock')} />
            ) : null}
            {lockLogic.store.step === 'lock' ? (
              <LockStep
                canGenerate={lockLogic.canGenerate}
                isLockPassphraseInvalid={lockLogic.isLockPassphraseInvalid}
                lockError={lockLogic.lockError}
                lockPending={lockLogic.lockPending}
                lockSecretWarning={lockLogic.lockSecretWarning}
                onBack={() => {
                  if (lockLogic.lockPending) return;
                  lockLogic.clearLockError();
                  lockLogic.store.setStep('onboarding');
                }}
                onGenerate={() => void lockLogic.handleGenerate()}
                onPassphraseChange={lockLogic.handlePassphraseChange}
                passphrase={lockLogic.store.passphrase}
              />
            ) : null}
            {lockLogic.store.step === 'locked' ? (
              <LockedStep safetyCodeAvailable={lockLogic.store.safetyCode} />
            ) : null}
          </>
        ) : null}

        {!publicState.isPublicStatusLoading &&
        !publicState.isUnavailable &&
        publicState.channelState === CHANNEL_STATE.LOCKED ? (
          <LockedStep safetyCodeAvailable={lockLogic.store.safetyCode} />
        ) : null}

        {!publicState.isUnavailable && isDeliveredState ? (
          <DeliveredStep
            canBurn={decryptLogic.canBurn}
            canDecrypt={decryptLogic.canDecrypt}
            decryptError={decryptLogic.decryptError}
            decryptPending={decryptLogic.decryptPending}
            isDecryptPassphraseInvalid={decryptLogic.isDecryptPassphraseInvalid}
            localPlaintextBurned={decryptLogic.store.localPlaintextBurned}
            onBurn={decryptLogic.handleBurn}
            onDecrypt={() => void decryptLogic.handleDecrypt()}
            onPassphraseChange={decryptLogic.handlePassphraseChange}
            passphrase={decryptLogic.passphrase}
            plaintext={decryptLogic.store.plaintext}
          />
        ) : null}
      </PageCardContent>
    </PageCard>
  );
}
