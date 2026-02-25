import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';

function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/70 bg-card/80 text-card-foreground shadow-[0_20px_64px_rgb(0_0_0_/_0.45)] backdrop-blur-xl',
        className
      )}
      data-slot="card"
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-col gap-2 p-6', className)} data-slot="card-header" {...props} />
  );
}

type CardTitleProps = ComponentProps<'h3'> & {
  asChild?: boolean;
};

function CardTitle({ asChild = false, className, ...props }: CardTitleProps) {
  const Comp = asChild ? Slot : 'h3';

  return (
    <Comp
      className={cn('font-semibold leading-none tracking-tight', className)}
      data-slot="card-title"
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn('text-sm text-muted-foreground', className)}
      data-slot="card-description"
      {...props}
    />
  );
}

function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-6 pt-0', className)} data-slot="card-content" {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center p-6 pt-0', className)}
      data-slot="card-footer"
      {...props}
    />
  );
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
