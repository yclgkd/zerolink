import type { SafetyCodeDisplay } from '@zerolink/shared';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';
import { PageCardContent, PageCardHeader, PageCardTitle } from '../layout';
import { Card } from '../ui/card';
import { resolveSafetyCodeColors } from './safety-code-colors';

/**
 * Props for rendering Safety Code in emoji/color modes with advanced fingerprint details.
 */
export type SafetyCodeProps = {
  /** The safety code display information to be rendered (emoji, colors, fingerprints). */
  display: SafetyCodeDisplay;
  /** Optional additional CSS classes to apply to the root container. */
  className?: string;
  /** The default view to show on initial render (emoji or color). */
  defaultView?: 'emoji' | 'color';
  /** Optional custom palette to map color indices. */
  palette?: readonly string[];
  /** Optional hint text to display to the user for verification context. */
  verifyHint?: string;
  /** Controls spacing density for tighter mobile-first layouts. */
  density?: 'default' | 'compact';
};

type ViewType = 'emoji' | 'color';

function SafetyCodeHeaderToggle({
  verifyHint,
  view,
  setView,
  compact,
}: {
  verifyHint: string;
  view: ViewType;
  setView: (view: ViewType) => void;
  compact: boolean;
}) {
  const { t } = useTranslation();
  return (
    <PageCardHeader className={cn(compact ? 'gap-3 p-5 pb-4' : 'gap-4')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <PageCardTitle className={cn(compact ? 'text-base' : 'text-lg')}>
            {t('safetyCode.title')}
          </PageCardTitle>
          <p
            className={cn(
              'mt-1 text-sm text-muted-foreground',
              compact ? 'leading-5' : 'leading-6'
            )}
          >
            {verifyHint}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            aria-pressed={view === 'emoji'}
            className={cn(
              'rounded-full border font-medium transition-colors',
              compact ? 'px-2.5 py-1 text-sm' : 'px-3 py-1.5 text-sm',
              view === 'emoji'
                ? 'border-primary/35 bg-primary/10 text-primary'
                : 'border-border/70 bg-background/30 text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setView('emoji')}
            type="button"
          >
            {t('safetyCode.emojiTab')}
          </button>
          <button
            aria-pressed={view === 'color'}
            className={cn(
              'rounded-full border font-medium transition-colors',
              compact ? 'px-2.5 py-1 text-sm' : 'px-3 py-1.5 text-sm',
              view === 'color'
                ? 'border-primary/35 bg-primary/10 text-primary'
                : 'border-border/70 bg-background/30 text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setView('color')}
            type="button"
          >
            {t('safetyCode.colorTab')}
          </button>
        </div>
      </div>
    </PageCardHeader>
  );
}

function EmojiGrid({
  cells,
  compact,
}: {
  cells: { id: string; testId: string; emoji: string }[];
  compact: boolean;
}) {
  return (
    <div className={cn('flex flex-wrap justify-center', compact ? 'gap-1.5' : 'gap-2')}>
      {cells.map((item) => (
        <div
          className={cn(
            'flex items-center justify-center rounded-xl border border-border/70 bg-background/35',
            compact ? 'h-10 w-10 text-base' : 'h-11 w-11 text-lg'
          )}
          data-testid={item.testId}
          key={item.id}
        >
          {item.emoji}
        </div>
      ))}
    </div>
  );
}

function ColorGrid({
  cells,
  compact,
}: {
  cells: { id: string; testId: string; color: string }[];
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        'mx-auto grid grid-cols-4',
        compact ? 'max-w-[13.5rem] gap-1.5' : 'max-w-xs gap-2'
      )}
    >
      {cells.map((item) => (
        <div
          className="aspect-square rounded-xl border border-border/70"
          data-testid={item.testId}
          key={item.id}
          style={{ backgroundColor: item.color }}
        />
      ))}
    </div>
  );
}

function AdvancedFingerprintSection({
  display,
  showAdvanced,
  setShowAdvanced,
  compact,
}: {
  display: SafetyCodeDisplay;
  showAdvanced: boolean;
  setShowAdvanced: React.Dispatch<React.SetStateAction<boolean>>;
  compact: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('border-t border-border/50', compact ? 'pt-2.5' : 'pt-3')}>
      <button
        aria-expanded={showAdvanced}
        className={cn(
          'flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground',
          compact ? 'text-sm' : 'text-sm'
        )}
        onClick={() => setShowAdvanced((current) => !current)}
        type="button"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn('size-3.5 transition-transform', showAdvanced && 'rotate-180')}
        />
        {t('safetyCode.advancedToggle')}
      </button>

      {showAdvanced ? (
        <div
          className={cn('mt-3 space-y-2', compact && 'space-y-3')}
          data-testid="safety-code-advanced-content"
        >
          <div>
            <p className="text-sm text-muted-foreground">{t('safetyCode.shortFprLabel')}</p>
            <code className="block text-sm leading-6 text-primary">{display.shortFpr}</code>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('safetyCode.fullFprLabel')}</p>
            <code className="block break-all text-sm leading-6 text-primary">
              {display.fullFpr}
            </code>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Displays the receiver fingerprint in user-friendly and advanced representations.
 */
export function SafetyCode({
  display,
  className,
  defaultView = 'color',
  palette,
  verifyHint,
  density = 'default',
}: SafetyCodeProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<ViewType>(defaultView);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const compact = density === 'compact';
  const resolvedVerifyHint = verifyHint ?? t('safetyCode.verifyHint');
  const colors = resolveSafetyCodeColors(display.color.cells, palette);

  const emojiCells = display.emoji.emojis.map((emoji, index) => ({
    emoji,
    id: `${display.shortFpr}-emoji-${display.fullFpr.slice(index * 2, index * 2 + 2)}-${emoji}`,
    testId: `safety-code-emoji-cell-${index}`,
  }));

  const colorCells = colors.map((color, index) => ({
    color,
    id: `${display.shortFpr}-color-${display.fullFpr.slice(index * 2, index * 2 + 2)}-${color}`,
    testId: `safety-code-color-cell-${index}`,
  }));

  return (
    <Card
      className={cn('rounded-2xl border-border/70 bg-card/45 shadow-none', className)}
      data-testid="safety-code-root"
    >
      <SafetyCodeHeaderToggle
        compact={compact}
        setView={setView}
        verifyHint={resolvedVerifyHint}
        view={view}
      />

      <PageCardContent className={cn(compact ? 'space-y-3 p-5 pt-0' : 'space-y-4')}>
        {view === 'emoji' ? (
          <EmojiGrid cells={emojiCells} compact={compact} />
        ) : (
          <ColorGrid cells={colorCells} compact={compact} />
        )}

        <AdvancedFingerprintSection
          compact={compact}
          display={display}
          setShowAdvanced={setShowAdvanced}
          showAdvanced={showAdvanced}
        />
      </PageCardContent>
    </Card>
  );
}
