import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';
import {
  getPassphraseStrength,
  type PassphraseStrength,
  type PassphraseStrengthLabel,
} from './passphrase-strength';

/**
 * Controlled passphrase input with visibility toggle and optional strength UI.
 */
export type PassphraseInputProps = {
  /** Controlled passphrase value. */
  value: string;
  /** Updates the controlled passphrase value. */
  onChange: (value: string) => void;
  /** Placeholder shown when no value is present. */
  placeholder?: string;
  /** Shows strength label and progress segments when true. */
  showStrength?: boolean;
  /** Optional class name applied to the component root. */
  className?: string;
  /** Optional ID passed to the underlying input element. */
  inputId?: string | undefined;
  /** Accessible label for the passphrase input. */
  label?: string | undefined;
  /** Marks the input invalid for assistive technologies. */
  ariaInvalid?: boolean | undefined;
  /** ID reference for contextual error/help text. */
  ariaDescribedBy?: string | undefined;
};

function getLabelClass(level: 0 | 1 | 2 | 3): string {
  if (level === 1) return 'text-destructive';
  if (level === 2) return 'text-amber-200';
  if (level === 3) return 'text-emerald-200';
  return 'text-muted-foreground';
}

function getSegmentClass(strengthLevel: 0 | 1 | 2 | 3, segmentLevel: 1 | 2 | 3): string {
  if (segmentLevel > strengthLevel) {
    return 'bg-muted';
  }

  if (strengthLevel === 1) return 'bg-destructive';
  if (strengthLevel === 2) return 'bg-amber-300';
  return 'bg-emerald-300';
}

const strengthKeyMap: Record<Exclude<PassphraseStrengthLabel, ''>, string> = {
  Weak: 'passphrase.weak',
  Medium: 'passphrase.medium',
  Strong: 'passphrase.strong',
};

function PassphraseStrengthIndicator({ strength }: { strength: PassphraseStrength }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{t('passphrase.strengthLabel')}</span>
        <span className={cn('text-sm font-medium', getLabelClass(strength.level))}>
          {strength.label ? t(strengthKeyMap[strength.label]) : ''}
        </span>
      </div>
      <div className="flex gap-1.5">
        {([1, 2, 3] as const).map((segmentLevel) => (
          <div
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              getSegmentClass(strength.level, segmentLevel)
            )}
            data-testid={`passphrase-strength-segment-${segmentLevel}`}
            key={segmentLevel}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Renders passphrase input with soft validation feedback.
 */
export function PassphraseInput({
  value,
  onChange,
  placeholder,
  showStrength = true,
  className,
  inputId,
  label,
  ariaInvalid,
  ariaDescribedBy,
}: PassphraseInputProps) {
  const { t } = useTranslation();
  const [showPassphrase, setShowPassphrase] = useState(false);
  const generatedId = useId();
  const resolvedInputId = inputId ?? `passphrase-input-${generatedId.replace(/:/gu, '')}`;
  const resolvedLabel = label ?? t('passphrase.defaultLabel');
  const resolvedPlaceholder = placeholder ?? t('passphrase.defaultPlaceholder');
  const strength = getPassphraseStrength(value);

  return (
    <div className={cn('space-y-3', className)} data-testid="passphrase-input-root">
      <label className="text-sm font-medium text-foreground" htmlFor={resolvedInputId}>
        {resolvedLabel}
      </label>
      <div className="relative">
        <input
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          autoComplete="off"
          className={cn(
            'w-full rounded-2xl border px-4 py-3 pr-12 transition focus-visible:outline-none focus-visible:ring-2',
            'border-input bg-input-background text-foreground placeholder:text-muted-foreground',
            'focus-visible:ring-ring'
          )}
          data-testid="passphrase-input-field"
          id={resolvedInputId}
          onChange={(event) => onChange(event.target.value)}
          placeholder={resolvedPlaceholder}
          type={showPassphrase ? 'text' : 'password'}
          value={value}
        />
        <button
          aria-label={showPassphrase ? t('passphrase.hideButton') : t('passphrase.showButton')}
          className="absolute right-1.5 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-background/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setShowPassphrase((current) => !current)}
          type="button"
        >
          {showPassphrase ? (
            <EyeOff aria-hidden="true" className="size-5" />
          ) : (
            <Eye aria-hidden="true" className="size-5" />
          )}
        </button>
      </div>

      {showStrength && value ? <PassphraseStrengthIndicator strength={strength} /> : null}
    </div>
  );
}
