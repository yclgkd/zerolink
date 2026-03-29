import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_PASSPHRASE_LENGTH, normalizePassphrase } from '../../crypto/passphrase-policy';
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
  /** Optional helper text shown below the input. */
  helperText?: string | undefined;
};

function getLabelClass(level: 0 | 1 | 2 | 3): string {
  if (level === 1) return 'text-destructive';
  if (level === 2) return 'text-neon-amber';
  if (level === 3) return 'text-neon-green';
  return 'text-muted-foreground';
}

function getSegmentClass(strengthLevel: 0 | 1 | 2 | 3, segmentLevel: 1 | 2 | 3): string {
  if (segmentLevel > strengthLevel) {
    return 'bg-muted';
  }

  if (strengthLevel === 1) return 'bg-destructive';
  if (strengthLevel === 2) return 'bg-neon-amber';
  return 'bg-neon-green';
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
        <span className="text-xs text-muted-foreground">{t('passphrase.strengthLabel')}</span>
        <span className={cn('text-xs font-medium', getLabelClass(strength.level))}>
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
  helperText,
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
      <label className="sr-only" htmlFor={resolvedInputId}>
        {resolvedLabel}
      </label>
      <div className="relative">
        <input
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          autoComplete="off"
          className={cn(
            'w-full rounded-xl border px-4 py-3 transition focus-visible:outline-none focus-visible:ring-2',
            'border-input bg-input-background text-foreground placeholder:text-muted-foreground',
            'focus-visible:ring-ring'
          )}
          data-testid="passphrase-input-field"
          id={resolvedInputId}
          maxLength={MAX_PASSPHRASE_LENGTH}
          onBlur={() => {
            const normalizedValue = normalizePassphrase(value);
            if (normalizedValue !== value) {
              onChange(normalizedValue);
            }
          }}
          onChange={(event) => onChange(event.target.value)}
          placeholder={resolvedPlaceholder}
          type={showPassphrase ? 'text' : 'password'}
          value={value}
        />
        <button
          aria-label={showPassphrase ? t('passphrase.hideButton') : t('passphrase.showButton')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
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

      {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}

      {showStrength && value ? <PassphraseStrengthIndicator strength={strength} /> : null}
    </div>
  );
}
