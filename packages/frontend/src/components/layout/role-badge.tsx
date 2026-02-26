import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';

const roleConfig = {
  sender: {
    label: 'Sender',
    className:
      'border-[color:rgb(168_85_247_/_0.35)] bg-[color:rgb(168_85_247_/_0.15)] text-primary',
  },
  receiver: {
    label: 'Receiver',
    className:
      'border-[color:rgb(6_182_212_/_0.4)] bg-[color:rgb(6_182_212_/_0.1)] text-[var(--neon-cyan)]',
  },
} as const;

type RoleBadgeParty = keyof typeof roleConfig;

type RoleBadgeProps = Omit<ComponentProps<typeof Badge>, 'variant'> & {
  party: RoleBadgeParty;
};

function RoleBadge({ party, className, children, ...props }: RoleBadgeProps) {
  const config = roleConfig[party];

  return (
    <Badge className={cn(config.className, className)} variant="secondary" {...props}>
      {children ?? config.label}
    </Badge>
  );
}

export { RoleBadge, type RoleBadgeParty };
