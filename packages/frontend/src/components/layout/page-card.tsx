import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';

const toneClasses = {
  purple: 'border-neon-purple/30 shadow-[0_0_30px] shadow-neon-purple/15',
  magenta: 'border-neon-magenta/30 shadow-[0_0_30px] shadow-neon-magenta/15',
  orange: 'border-neon-orange/30 shadow-[0_0_30px] shadow-neon-orange/15',
  cyan: 'border-neon-cyan/30 shadow-[0_0_30px] shadow-neon-cyan/15',
} as const;

export type PageCardTone = keyof typeof toneClasses;

type PageCardProps = ComponentProps<'div'> & {
  tone?: PageCardTone;
};

function PageCard({ tone = 'purple', className, ...props }: PageCardProps) {
  return <Card className={cn('animate-fade-in-up', toneClasses[tone], className)} {...props} />;
}

function PageCardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <CardHeader className={cn('gap-3', className)} {...props} />;
}

type PageCardTitleProps = ComponentProps<'h3'> & {
  asChild?: boolean;
};

function PageCardTitle({ asChild = false, className, ...props }: PageCardTitleProps) {
  return <CardTitle asChild={asChild} className={cn('text-2xl', className)} {...props} />;
}

function PageCardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <CardDescription className={className} {...props} />;
}

function PageCardContent({ className, ...props }: ComponentProps<'div'>) {
  return <CardContent className={cn('pt-0 text-sm text-muted-foreground', className)} {...props} />;
}

const PageCardFooter = CardFooter;

export {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardFooter,
  PageCardHeader,
  PageCardTitle,
};
