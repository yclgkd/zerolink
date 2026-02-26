import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';

const toneClasses = {
  purple: 'border-[color:rgb(168_85_247_/_0.3)] shadow-[0_0_30px_rgb(168_85_247_/_0.15)]',
  magenta: 'border-[color:rgb(236_72_153_/_0.3)] shadow-[0_0_30px_rgb(236_72_153_/_0.15)]',
  orange: 'border-[color:rgb(249_115_22_/_0.3)] shadow-[0_0_30px_rgb(249_115_22_/_0.15)]',
  cyan: 'border-[color:rgb(6_182_212_/_0.3)] shadow-[0_0_30px_rgb(6_182_212_/_0.15)]',
} as const;

export type PageCardTone = keyof typeof toneClasses;

type PageCardProps = ComponentProps<'div'> & {
  tone?: PageCardTone;
};

function PageCard({ tone = 'purple', className, ...props }: PageCardProps) {
  return <Card className={cn(toneClasses[tone], className)} {...props} />;
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
  return <CardDescription className={cn('text-muted-foreground', className)} {...props} />;
}

function PageCardContent({ className, ...props }: ComponentProps<'div'>) {
  return <CardContent className={cn('pt-0 text-sm text-muted-foreground', className)} {...props} />;
}

function PageCardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <CardFooter className={cn(className)} {...props} />;
}

export {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardFooter,
  PageCardHeader,
  PageCardTitle,
};
