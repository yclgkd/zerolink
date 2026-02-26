import type { SecurityProfile } from '@zerolink/shared';
import { KeyRound, type LucideIcon, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../../lib/utils';
import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  type PageCardTone,
} from '../layout';

export type SecurityProfileCardProps = {
  profile: SecurityProfile;
  selected: boolean;
  onSelect: (profile: SecurityProfile) => void;
  className?: string;
};

export type SecurityProfileCardConfig = {
  title: string;
  tagline: string;
  points: readonly string[];
  details: string;
  icon: LucideIcon;
  tone: PageCardTone;
  selectedRingClass: string;
};

export const SecurityProfileCardConfigs: Record<SecurityProfile, SecurityProfileCardConfig> = {
  standard: {
    title: 'Standard',
    tagline: 'Balanced security for everyday encrypted delivery.',
    points: [
      'Passkeys or security keys',
      'Argon2id-protected key wrapping',
      '4 KB ciphertext padding',
    ],
    details:
      'Recommended for most channels. Supports platform passkeys while preserving strong cryptographic defaults.',
    icon: ShieldCheck,
    tone: 'purple',
    selectedRingClass: 'ring-2 ring-neon-purple/60',
  },
  strict: {
    title: 'Strict',
    tagline: 'Stronger verification with tighter passkey policy.',
    points: [
      'User verification is required',
      'Discourages synced backup passkeys',
      '8 KB ciphertext padding',
    ],
    details:
      'Use when both participants can satisfy stricter policy checks and need more explicit identity assurance.',
    icon: ShieldAlert,
    tone: 'magenta',
    selectedRingClass: 'ring-2 ring-neon-magenta/60',
  },
  hardware_only: {
    title: 'Hardware-Only',
    tagline: 'Highest assurance with dedicated FIDO2 hardware keys.',
    points: [
      'Cross-platform hardware key required',
      'Attestation validation expected',
      '8 KB ciphertext padding',
    ],
    details:
      'Best fit for high-risk handoffs where both parties can use external security keys and hardware-backed credentials.',
    icon: KeyRound,
    tone: 'orange',
    selectedRingClass: 'ring-2 ring-neon-orange/60',
  },
};

export function SecurityProfileCard({
  profile,
  selected,
  onSelect,
  className,
}: SecurityProfileCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = SecurityProfileCardConfigs[profile];
  const Icon = config.icon;

  const handleLearnMoreClick = () => {
    setExpanded((current) => !current);
  };

  return (
    <PageCard
      className={cn(
        'group h-full transition',
        selected ? config.selectedRingClass : 'ring-1 ring-transparent',
        className
      )}
      data-testid={`security-profile-card-${profile}`}
      tone={config.tone}
    >
      <PageCardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <PageCardTitle className="text-lg text-foreground">{config.title}</PageCardTitle>
          <span
            className="rounded-md border border-border/70 bg-card/60 p-2 text-muted-foreground"
            data-testid={`security-profile-icon-${profile}`}
          >
            <Icon aria-hidden="true" className="size-4" />
          </span>
        </div>
        <PageCardDescription>{config.tagline}</PageCardDescription>
      </PageCardHeader>
      <PageCardContent className="space-y-3 text-sm text-muted-foreground">
        <ul className="list-disc space-y-1 pl-5">
          {config.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <button
            aria-pressed={selected}
            className={cn(
              'inline-flex rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
              selected
                ? 'border-primary/70 bg-primary/10 text-primary'
                : 'border-border/70 bg-card/60 text-foreground hover:bg-card'
            )}
            data-testid={`security-profile-select-${profile}`}
            onClick={() => onSelect(profile)}
            type="button"
          >
            {selected ? 'Selected' : 'Select profile'}
          </button>
          <button
            aria-expanded={expanded}
            className="inline-flex text-xs font-medium text-primary hover:text-primary/80"
            data-testid={`security-profile-learn-more-${profile}`}
            onClick={handleLearnMoreClick}
            type="button"
          >
            Learn more
          </button>
        </div>
        {expanded ? (
          <p data-testid={`security-profile-details-${profile}`} role="note">
            {config.details}
          </p>
        ) : null}
      </PageCardContent>
    </PageCard>
  );
}
