import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';

const toneClasses = {
  purple: 'border-primary/16 shadow-[0_20px_56px_rgb(2_8_23_/_0.28)]',
  magenta: 'border-slate-300/14 shadow-[0_20px_56px_rgb(2_8_23_/_0.28)]',
  orange: 'border-amber-300/16 shadow-[0_20px_56px_rgb(2_8_23_/_0.28)]',
  cyan: 'border-sky-300/16 shadow-[0_20px_56px_rgb(2_8_23_/_0.28)]',
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
