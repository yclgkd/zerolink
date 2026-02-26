import type { HexString, SafetyCodeDisplay } from '@zerolink/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  RoleBadge,
} from '../components/layout';
import { PassphraseInput } from '../components/lock/passphrase-input';
import { SafetyCode } from '../components/safety/safety-code';
import { Button } from '../components/ui/button';

type SharePageStep = 'onboarding' | 'lock' | 'locked';

const onboardingItems = [
  {
    emoji: '🔐',
    title: 'Your passphrase stays on this device',
    description: 'It never gets sent to the server or shared with the sender.',
  },
  {
    emoji: '🔑',
    title: 'It generates your key locally',
    description: "The sender can't see your passphrase or private key material.",
  },
  {
    emoji: '🔒',
    title: 'After locking, only you can unlock',
    description: 'Delivery stays encrypted for your receiver identity only.',
  },
] as const;

const nextSteps = [
  'Contact the sender through another channel.',
  'Compare Safety Code values before delivery.',
  'Keep this tab open until the sender confirms delivery.',
] as const;

const mockSafetyCodeDisplay: SafetyCodeDisplay = {
  emoji: {
    type: 'emoji',
    emojis: ['🔥', '🌲', '🚀', '🔮', '💎', '🎯', '⚡', '🌙'],
  },
  color: {
    type: 'color',
    cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
  shortFpr: 'a1b2c3d4e5f6...f1e2d3c4b5a6',
  fullFpr: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00' as HexString,
};

export function SharePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();
  const [step, setStep] = useState<SharePageStep>('onboarding');
  const [passphrase, setPassphrase] = useState('');
  const canGenerate = passphrase.trim().length > 0;

  function handleContinue(): void {
    setStep('lock');
  }

  function handleBack(): void {
    setStep('onboarding');
  }

  function handleGenerate(): void {
    if (!canGenerate) {
      return;
    }

    setStep('locked');
  }

  return (
    <PageCard data-testid="page-share" tone="cyan">
      <PageCardHeader>
        <div className="flex items-center justify-between gap-3">
          <PageCardTitle asChild className="text-[var(--neon-cyan)]">
            <h2>Share / Unlock</h2>
          </PageCardTitle>
          <RoleBadge party="receiver" />
        </div>
        <PageCardDescription>
          Receiver-side lock flow UI before decrypt integration.
        </PageCardDescription>
      </PageCardHeader>
      <PageCardContent className="space-y-6">
        <p>
          UUID:{' '}
          <code
            className="rounded bg-muted px-2 py-1 text-xs text-[var(--neon-cyan)]"
            data-testid="share-uuid"
          >
            {uuid ?? '(missing uuid)'}
          </code>
        </p>

        {step === 'onboarding' ? (
          <section className="space-y-4" data-testid="share-step-onboarding">
            <h3 className="text-base font-semibold text-foreground">Lock This Channel</h3>
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
            <Button data-testid="share-continue-button" onClick={handleContinue} type="button">
              Continue to Lock
            </Button>
          </section>
        ) : null}

        {step === 'lock' ? (
          <section className="space-y-4" data-testid="share-step-lock">
            <h3 className="text-base font-semibold text-foreground">Generate Key & Lock</h3>
            <PassphraseInput
              onChange={setPassphrase}
              placeholder="Enter a strong passphrase"
              value={passphrase}
            />
            <div className="flex gap-2">
              <Button
                data-testid="share-back-button"
                onClick={handleBack}
                type="button"
                variant="secondary"
              >
                Back
              </Button>
              <Button
                data-testid="share-generate-button"
                disabled={!canGenerate}
                onClick={handleGenerate}
                type="button"
              >
                Generate Key & Lock
              </Button>
            </div>
          </section>
        ) : null}

        {step === 'locked' ? (
          <section className="space-y-4" data-testid="share-step-locked">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">
                Channel Locked Successfully
              </h3>
              <p className="text-xs text-muted-foreground">
                Verify the Safety Code with the sender before delivery.
              </p>
            </div>
            <SafetyCode display={mockSafetyCodeDisplay} />
            <div
              className="space-y-2 rounded-xl border border-neon-cyan/35 bg-neon-cyan/10 p-4"
              data-testid="share-next-steps"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-neon-cyan">
                Next Steps
              </p>
              <ol className="space-y-1 text-sm text-foreground">
                {nextSteps.map((stepText) => (
                  <li key={stepText}>{stepText}</li>
                ))}
              </ol>
            </div>
          </section>
        ) : null}
      </PageCardContent>
    </PageCard>
  );
}
