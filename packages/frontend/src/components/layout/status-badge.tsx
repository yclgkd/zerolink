import type { ChannelState } from '@zerolink/shared';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';

const statusConfig: Record<ChannelState, { className: string; icon: string; label: string }> = {
  waiting: {
    label: 'Waiting for Lock',
    icon: '\u23F3',
    className: 'border-neon-amber/30 bg-neon-amber/10 text-neon-amber',
  },
  locked: {
    label: 'Locked by Receiver',
    icon: '\uD83D\uDD12',
    className: 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan',
  },
  delivered: {
    label: 'Delivered',
    icon: '\u2728',
    className: 'border-neon-green/30 bg-neon-green/10 text-neon-green',
  },
  deleted: {
    label: 'Deleted',
    icon: '\uD83D\uDDD1',
    className: 'border-neon-slate/30 bg-neon-slate/10 text-neon-slate',
  },
  expired: {
    label: 'Expired',
    icon: '\u26D4',
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
};

type StatusBadgeProps = Omit<ComponentProps<typeof Badge>, 'children' | 'variant'> & {
  status: ChannelState;
};

function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm',
        config.className,
        className
      )}
      data-status={status}
      variant="secondary"
      {...props}
    >
      <span aria-hidden="true" className="text-base leading-none">
        {config.icon}
      </span>
      <span className="font-medium">{config.label}</span>
    </Badge>
  );
}

export { StatusBadge };
