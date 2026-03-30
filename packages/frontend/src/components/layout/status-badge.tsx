import type { ChannelState } from '@zerolink/shared';
import { CheckCircle, Clock, Lock, Timer, Trash2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

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
    className: 'border-amber-300/24 bg-amber-400/8 text-amber-200',
  },
  locked: {
    label: 'Locked by Receiver',
    icon: Lock,
    className: 'border-sky-300/24 bg-sky-400/8 text-sky-200',
  },
  delivered: {
    label: 'Delivered',
    icon: CheckCircle,
    className: 'border-emerald-300/24 bg-emerald-400/8 text-emerald-200',
  },
  deleted: {
    label: 'Deleted',
    icon: Trash2,
    className: 'border-slate-300/20 bg-slate-400/8 text-slate-300',
  },
  expired: {
    label: 'Expired',
    icon: Timer,
    className: 'border-destructive/24 bg-destructive/8 text-destructive',
  },
};

type StatusBadgeProps = Omit<ComponentProps<typeof Badge>, 'children' | 'variant'> & {
  status: ChannelState;
};

function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const { t } = useTranslation();
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
      <span className="font-medium">{t(`status.${status}`)}</span>
    </Badge>
  );
}

export { StatusBadge };
