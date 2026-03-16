import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';

const roleConfig = {
  sender: {
    label: 'Sender',
    className: 'border-neon-purple/35 bg-neon-purple/15 text-primary',
  },
  receiver: {
    label: 'Receiver',
    className: 'border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan',
  },
} as const;

export type RoleBadgeParty = keyof typeof roleConfig;

type RoleBadgeProps = Omit<ComponentProps<typeof Badge>, 'variant'> & {
  party: RoleBadgeParty;
};

function RoleBadge({ party, className, children, ...props }: RoleBadgeProps) {
  const { t } = useTranslation();
  const config = roleConfig[party];

  return (
    <Badge className={cn(config.className, className)} variant="secondary" {...props}>
      {children ?? t(`role.${party}`)}
    </Badge>
  );
}

export { RoleBadge };
