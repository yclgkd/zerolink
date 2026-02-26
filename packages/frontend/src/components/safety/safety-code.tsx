import type { SafetyCodeDisplay } from '@zerolink/shared';
import { useState } from 'react';

import { cn } from '../../lib/utils';
import { PageCard, PageCardContent, PageCardHeader, PageCardTitle } from '../layout';
import { resolveSafetyCodeColors } from './safety-code-colors';

const DEFAULT_VERIFY_HINT = 'Verify this code via another channel (phone, video call)';

/**
 * Props for rendering Safety Code in emoji/color modes with advanced fingerprint details.
 */
export type SafetyCodeProps = {
  display: SafetyCodeDisplay;
  className?: string;
  defaultView?: 'emoji' | 'color';
  palette?: readonly string[];
  verifyHint?: string;
};

/**
 * Displays the receiver fingerprint in user-friendly and advanced representations.
 */
export function SafetyCode({
  display,
  className,
  defaultView = 'emoji',
  palette,
  verifyHint = DEFAULT_VERIFY_HINT,
}: SafetyCodeProps) {
  const [view, setView] = useState<'emoji' | 'color'>(defaultView);
  const [showAdvanced, setShowAdvanced] = useState(false);
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
    <PageCard
      className={cn('border-neon-magenta/30 shadow-[0_0_30px] shadow-neon-magenta/15', className)}
      data-testid="safety-code-root"
      tone="magenta"
    >
      <PageCardHeader className="gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <PageCardTitle className="text-xl">Safety Code</PageCardTitle>
            <p className="text-sm text-muted-foreground">{verifyHint}</p>
          </div>
          <div className="flex gap-2">
            <button
              aria-pressed={view === 'emoji'}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                view === 'emoji'
                  ? 'border-neon-magenta/50 bg-neon-magenta/15 text-neon-magenta'
                  : 'border-border/70 bg-card/60 text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setView('emoji')}
              type="button"
            >
              Emoji
            </button>
            <button
              aria-pressed={view === 'color'}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                view === 'color'
                  ? 'border-neon-magenta/50 bg-neon-magenta/15 text-neon-magenta'
                  : 'border-border/70 bg-card/60 text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setView('color')}
              type="button"
            >
              Colors
            </button>
          </div>
        </div>
      </PageCardHeader>

      <PageCardContent className="space-y-4">
        {view === 'emoji' ? (
          <div className="flex flex-wrap justify-center gap-2">
            {emojiCells.map((item) => (
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/70 bg-card/70 text-lg"
                data-testid={item.testId}
                key={item.id}
              >
                {item.emoji}
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto grid max-w-xs grid-cols-4 gap-2">
            {colorCells.map((item) => (
              <div
                className="aspect-square rounded-lg border border-border/70"
                data-testid={item.testId}
                key={item.id}
                style={{ backgroundColor: item.color }}
              />
            ))}
          </div>
        )}

        <div className="border-t border-border/50 pt-3">
          <button
            aria-expanded={showAdvanced}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowAdvanced((current) => !current)}
            type="button"
          >
            Advanced fingerprint
          </button>

          {showAdvanced ? (
            <div className="mt-3 space-y-2" data-testid="safety-code-advanced-content">
              <div>
                <p className="text-xs text-muted-foreground">Short fingerprint</p>
                <code className="text-xs text-neon-cyan">{display.shortFpr}</code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Full hex fingerprint</p>
                <code className="break-all text-xs text-neon-cyan">{display.fullFpr}</code>
              </div>
            </div>
          ) : null}
        </div>
      </PageCardContent>
    </PageCard>
  );
}
