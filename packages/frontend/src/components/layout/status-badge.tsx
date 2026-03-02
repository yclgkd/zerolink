import type { ChannelState } from '@zerolink/shared';
import { CheckCircle, Clock, Lock, Timer, Trash2 } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';

const statusConfig: Record<
  ChannelState,
  {
    className: string;
    icon: React.ComponentType<{ 'aria-hidden': 'true'; className: string }>;
    label: string;
  }
> = {
  waiting: {
    label: 'Waiting for Lock',
    icon: Clock,
    className: 'border-neon-amber/30 bg-neon-amber/10 text-neon-amber',
  },
  locked: {
    label: 'Locked by Receiver',
    icon: Lock,
    className: 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan',
  },
  delivered: {
    label: 'Delivered',
    icon: CheckCircle,
    className: 'border-neon-green/30 bg-neon-green/10 text-neon-green',
  },
  deleted: {
    label: 'Deleted',
    icon: Trash2,
    className: 'border-neon-slate/30 bg-neon-slate/10 text-neon-slate',
  },
  expired: {
    label: 'Expired',
    icon: Timer,
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
};

type StatusBadgeProps = Omit<ComponentProps<typeof Badge>, 'children' | 'variant'> & {
  status: ChannelState;
};

function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const config = statusConfig[status];
  const IconComponent = config.icon;

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
      <IconComponent aria-hidden="true" className="size-3.5" />
      <span className="font-medium">{config.label}</span>
    </Badge>
  );
}

export { StatusBadge };
