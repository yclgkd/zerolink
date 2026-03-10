import type { SecurityProfile } from '@zerolink/shared';
import { KeyRound, Lock, type LucideIcon, ShieldAlert, ShieldCheck } from 'lucide-react';
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

/**
 * Properties for the SecurityProfileCard component.
 */
export type SecurityProfileCardProps = {
  /** The security profile to display */
  profile: SecurityProfile;
  /** Whether the profile is currently selected */
  selected: boolean;
  /** Callback triggered when the select button is clicked */
  onSelect: (profile: SecurityProfile) => void;
  /** Optional class name to merge into the card container */
  className?: string;
};

/**
 * Configuration for a specific security profile card variant.
 */
export type SecurityProfileCardConfig = {
  /** The display title of the profile */
  title: string;
  /** A short tagline describing the profile's purpose */
  tagline: string;
  /** Key feature bullet points */
  points: readonly string[];
  /** Detailed explanation of the profile (shown when expanded) */
  details: string;
  /** The Lucide icon associated with the profile */
  icon: LucideIcon;
  /** The visual tone/theme applied to the card */
  tone: PageCardTone;
  /** The CSS class string to apply when the card is selected */
  selectedRingClass: string;
  /** Icon color class when selected */
  selectedIconClass: string;
};

/**
 * Registry of configurations for all supported security profiles.
 */
export const SecurityProfileCardConfigs: Record<SecurityProfile, SecurityProfileCardConfig> = {
  quick: {
    title: 'Quick Share',
    tagline: 'Password-protected delivery — no passkey required.',
    points: [
      'Password-derived admin key (Argon2id)',
      'Works in any browser',
      '4 KB ciphertext padding',
    ],
    details:
      'Choose a strong password you will remember. The password protects your channel management key and is never sent to the server.',
    icon: Lock,
    tone: 'purple',
    selectedRingClass: 'ring-2 ring-neon-purple/60 shadow-[0_0_20px_rgba(168,85,247,0.3)]',
    selectedIconClass: 'border-neon-purple/50 bg-neon-purple/10 text-neon-purple',
  },
  secure: {
    title: 'Secure Share',
    tagline: 'Passkey-protected delivery — strongest security.',
    points: [
      'Passkey or hardware security key required',
      'User verification enforced',
      '8 KB ciphertext padding',
    ],
    details:
      'Uses your device passkey or external security key to manage this channel. User verification is always required.',
    icon: ShieldCheck,
    tone: 'magenta',
    selectedRingClass: 'ring-2 ring-neon-magenta/60 shadow-[0_0_20px_rgba(236,72,153,0.3)]',
    selectedIconClass: 'border-neon-magenta/50 bg-neon-magenta/10 text-neon-magenta',
  },
  // Legacy profiles — retained for rendering existing channels; not shown in new create UI
  standard: {
    title: 'Standard (Legacy)',
    tagline: 'Legacy profile — use Quick Share or Secure Share for new channels.',
    points: [
      'Passkeys or security keys',
      'Argon2id-protected key wrapping',
      '4 KB ciphertext padding',
    ],
    details: 'Legacy Standard profile. Existing channels with this profile continue to work.',
    icon: ShieldCheck,
    tone: 'purple',
    selectedRingClass: 'ring-2 ring-neon-purple/60 shadow-[0_0_20px_rgba(168,85,247,0.3)]',
    selectedIconClass: 'border-neon-purple/50 bg-neon-purple/10 text-neon-purple',
  },
  strict: {
    title: 'Strict (Legacy)',
    tagline: 'Legacy profile — use Secure Share for new channels.',
    points: ['User verification required', '8 KB ciphertext padding'],
    details: 'Legacy Strict profile. Existing channels with this profile continue to work.',
    icon: ShieldAlert,
    tone: 'magenta',
    selectedRingClass: 'ring-2 ring-neon-magenta/60 shadow-[0_0_20px_rgba(236,72,153,0.3)]',
    selectedIconClass: 'border-neon-magenta/50 bg-neon-magenta/10 text-neon-magenta',
  },
  hardware_only: {
    title: 'Hardware-Only (Legacy)',
    tagline: 'Legacy profile — use Secure Share for new channels.',
    points: ['Cross-platform hardware key', '8 KB ciphertext padding'],
    details: 'Legacy Hardware-Only profile. Existing channels with this profile continue to work.',
    icon: KeyRound,
    tone: 'orange',
    selectedRingClass: 'ring-2 ring-neon-orange/60 shadow-[0_0_20px_rgba(249,115,22,0.3)]',
    selectedIconClass: 'border-neon-orange/50 bg-neon-orange/10 text-neon-orange',
  },
};

function CardHeaderContent({
  profile,
  config,
  selected,
}: {
  profile: SecurityProfile;
  config: SecurityProfileCardConfig;
  selected: boolean;
}) {
  const Icon = config.icon;
  return (
    <PageCardHeader className="gap-2">
      <div className="flex items-start justify-between gap-3">
        <PageCardTitle className="text-lg text-foreground">{config.title}</PageCardTitle>
        <span
          className={cn(
            'rounded-md border p-2',
            selected
              ? config.selectedIconClass
              : 'border-border/70 bg-card/60 text-muted-foreground'
          )}
          data-testid={`security-profile-icon-${profile}`}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </div>
      <PageCardDescription>{config.tagline}</PageCardDescription>
    </PageCardHeader>
  );
}

function CardActionButtons({
  profile,
  selected,
  expanded,
  onSelect,
  onToggleExpand,
}: {
  profile: SecurityProfile;
  selected: boolean;
  expanded: boolean;
  onSelect: (profile: SecurityProfile) => void;
  onToggleExpand: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        aria-pressed={selected}
        className={cn(
          'inline-flex rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all duration-200',
          selected
            ? 'border-primary/70 bg-primary/10 text-primary'
            : 'border-border/70 bg-card/60 text-foreground hover:bg-card'
        )}
        data-testid={`security-profile-select-${profile}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(profile);
        }}
        type="button"
      >
        {selected ? 'Selected' : 'Select profile'}
      </button>
      <button
        aria-expanded={expanded}
        className="inline-flex text-xs font-medium text-primary hover:text-primary/80"
        data-testid={`security-profile-learn-more-${profile}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleExpand();
        }}
        type="button"
      >
        Learn more
      </button>
    </div>
  );
}

/**
 * A selectable card component that displays the details and options for a given security profile.
 */
export function SecurityProfileCard({
  profile,
  selected,
  onSelect,
  className,
}: SecurityProfileCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = SecurityProfileCardConfigs[profile];

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(profile);
    }
  }

  return (
    <PageCard
      className={cn(
        'group h-full cursor-pointer transition-transform duration-200 hover:-translate-y-0.5 hover:border-border/60',
        selected ? config.selectedRingClass : 'ring-1 ring-transparent',
        className
      )}
      data-testid={`security-profile-card-${profile}`}
      onClick={() => onSelect(profile)}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      tone={config.tone}
    >
      <CardHeaderContent config={config} profile={profile} selected={selected} />
      <PageCardContent className="space-y-3 text-sm text-muted-foreground">
        <ul className="list-disc space-y-1 pl-5">
          {config.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <CardActionButtons
          expanded={expanded}
          onSelect={onSelect}
          onToggleExpand={() => setExpanded((curr) => !curr)}
          profile={profile}
          selected={selected}
        />
        {expanded ? (
          <p data-testid={`security-profile-details-${profile}`} role="note">
            {config.details}
          </p>
        ) : null}
      </PageCardContent>
    </PageCard>
  );
}
