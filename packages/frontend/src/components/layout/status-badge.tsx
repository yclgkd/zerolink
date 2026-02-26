import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';

export type ChannelStatus = 'waiting' | 'locked' | 'delivered' | 'deleted' | 'expired';

const statusConfig: Record<ChannelStatus, { className: string; icon: string; label: string }> = {
  waiting: {
    label: 'Waiting for Lock',
    icon: '⏳',
    className:
      'border-[color:rgb(245_158_11_/_0.3)] bg-[color:rgb(245_158_11_/_0.1)] text-[#f59e0b]',
  },
  locked: {
    label: 'Locked by Receiver',
    icon: '🔒',
    className: 'border-[color:rgb(6_182_212_/_0.3)] bg-[color:rgb(6_182_212_/_0.1)] text-[#06b6d4]',
  },
  delivered: {
    label: 'Delivered',
    icon: '✨',
    className:
      'border-[color:rgb(16_185_129_/_0.3)] bg-[color:rgb(16_185_129_/_0.1)] text-[#10b981]',
  },
  deleted: {
    label: 'Deleted',
    icon: '🗑',
    className:
      'border-[color:rgb(100_116_139_/_0.3)] bg-[color:rgb(100_116_139_/_0.1)] text-[#64748b]',
  },
  expired: {
    label: 'Expired',
    icon: '⛔',
    className: 'border-[color:rgb(239_68_68_/_0.3)] bg-[color:rgb(239_68_68_/_0.1)] text-[#ef4444]',
  },
};

type StatusBadgeProps = Omit<ComponentProps<typeof Badge>, 'children' | 'variant'> & {
  status: ChannelStatus;
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
