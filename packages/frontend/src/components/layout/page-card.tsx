import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';

const toneClasses = {
  purple: 'border-neon-purple/18 shadow-[0_24px_72px_rgb(3_10_24_/_0.34)]',
  magenta: 'border-neon-magenta/18 shadow-[0_24px_72px_rgb(3_10_24_/_0.34)]',
  orange: 'border-neon-orange/18 shadow-[0_24px_72px_rgb(3_10_24_/_0.34)]',
  cyan: 'border-neon-cyan/18 shadow-[0_24px_72px_rgb(3_10_24_/_0.34)]',
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
  return (
    <CardTitle asChild={asChild} className={cn('text-2xl md:text-[2rem]', className)} {...props} />
  );
}

function PageCardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <CardDescription className={className} {...props} />;
}

function PageCardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <CardContent
      className={cn('pt-0 text-sm text-muted-foreground md:text-[0.95rem]', className)}
      {...props}
    />
  );
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
