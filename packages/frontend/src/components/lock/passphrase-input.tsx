import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';

import { cn } from '../../lib/utils';
import { getPassphraseStrength, type PassphraseStrength } from './passphrase-strength';

const STRICT_WARNING_TEXT =
  'Strict mode recommends a stronger passphrase (12+ characters with mixed case, numbers, and symbols)';

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
  /** Enables strict mode warning for weak passphrases. */
  strictMode?: boolean;
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

function PassphraseStrengthIndicator({
  strength,
  showWarning,
}: {
  strength: PassphraseStrength;
  showWarning: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Passphrase strength</span>
        <span className={cn('text-xs font-medium', getLabelClass(strength.level))}>
          {strength.label}
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
      {showWarning ? (
        <p className="rounded-lg border border-neon-amber/35 bg-neon-amber/10 px-3 py-2 text-xs text-neon-amber">
          {STRICT_WARNING_TEXT}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Renders passphrase input with soft validation feedback.
 */
export function PassphraseInput({
  value,
  onChange,
  placeholder = 'Enter passphrase',
  showStrength = true,
  strictMode = false,
  className,
  inputId,
  label = 'Passphrase',
  ariaInvalid,
  ariaDescribedBy,
}: PassphraseInputProps) {
  const [showPassphrase, setShowPassphrase] = useState(false);
  const generatedId = useId();
  const resolvedInputId = inputId ?? `passphrase-input-${generatedId.replace(/:/gu, '')}`;
  const strength = getPassphraseStrength(value);
  const showWarning = strictMode && Boolean(value) && strength.level === 1;

  return (
    <div className={cn('space-y-3', className)} data-testid="passphrase-input-root">
      <label className="sr-only" htmlFor={resolvedInputId}>
        {label}
      </label>
      <div className="relative">
        <input
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          className={cn(
            'w-full rounded-xl border px-4 py-3 transition focus-visible:outline-none focus-visible:ring-2',
            'border-input bg-input-background text-foreground placeholder:text-muted-foreground',
            showWarning
              ? 'border-neon-amber/60 focus-visible:ring-neon-amber/60'
              : 'focus-visible:ring-ring'
          )}
          data-testid="passphrase-input-field"
          id={resolvedInputId}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={showPassphrase ? 'text' : 'password'}
          value={value}
        />
        <button
          aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
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

      {showStrength && value ? (
        <PassphraseStrengthIndicator showWarning={showWarning} strength={strength} />
      ) : null}
    </div>
  );
}
