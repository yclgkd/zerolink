import type { ComponentProps } from 'react';
import { useEffect, useRef } from 'react';

import { cn } from '../../lib/utils';

const toneClasses = {
  error: 'border-destructive/35 bg-destructive/8 text-destructive',
  warning: 'border-amber-300/28 bg-amber-400/8 text-amber-200',
  info: 'border-sky-300/25 bg-sky-400/7 text-sky-200',
  success: 'border-emerald-300/25 bg-emerald-400/7 text-emerald-200',
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
