import type { ComponentProps } from 'react';
import { useEffect, useRef } from 'react';

import { cn } from '../../lib/utils';

const toneClasses = {
  error: 'border-destructive/35 bg-destructive/8 text-destructive',
  warning: 'border-neon-orange/28 bg-neon-orange/8 text-neon-orange',
  info: 'border-neon-cyan/25 bg-neon-cyan/7 text-neon-cyan',
  success: 'border-neon-green/25 bg-neon-green/7 text-neon-green',
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
      className={cn(
        'space-y-1.5 rounded-2xl border px-4 py-3.5 text-sm leading-6',
        toneClasses[tone],
        className
      )}
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
