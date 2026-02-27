import type { ComponentProps } from 'react';
import { useEffect, useRef } from 'react';

import { cn } from '../../lib/utils';

const toneClasses = {
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  warning: 'border-neon-orange/40 bg-neon-orange/10 text-neon-orange',
  info: 'border-neon-cyan/35 bg-neon-cyan/10 text-neon-cyan',
  success: 'border-neon-green/35 bg-neon-green/10 text-neon-green',
} as const;

export type StateNoticeTone = keyof typeof toneClasses;

export type StateNoticeProps = Omit<ComponentProps<'div'>, 'title'> & {
  tone?: StateNoticeTone;
  title?: string;
  autoFocusOnMount?: boolean;
};

/**
 * Unified status/error surface with consistent a11y semantics across pages.
 */
export function StateNotice({
  tone = 'info',
  title,
  className,
  autoFocusOnMount = false,
  role,
  tabIndex,
  children,
  'aria-live': ariaLive,
  ...props
}: StateNoticeProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocusOnMount) return;
    ref.current?.focus();
  }, [autoFocusOnMount]);

  const resolvedRole = role ?? (tone === 'error' ? 'alert' : 'status');
  const resolvedAriaLive = ariaLive ?? (tone === 'error' ? 'assertive' : 'polite');
  const resolvedTabIndex = autoFocusOnMount ? -1 : tabIndex;

  return (
    <div
      aria-live={resolvedAriaLive}
      className={cn('space-y-1 rounded-xl border p-3 text-xs', toneClasses[tone], className)}
      ref={ref}
      role={resolvedRole}
      tabIndex={resolvedTabIndex}
      {...props}
    >
      {title ? <p className="font-medium text-foreground">{title}</p> : null}
      {children}
    </div>
  );
}
