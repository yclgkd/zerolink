import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[opacity,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[0_14px_32px_rgb(56_189_248_/_0.18)] hover:bg-primary/92',
        secondary:
          'border border-border/70 bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline:
          'border border-border bg-background/35 text-muted-foreground hover:bg-card hover:text-foreground',
        ghost: 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
        danger:
          'border border-destructive/45 bg-destructive/10 text-destructive hover:bg-destructive/16',
      },
      size: {
        default: 'h-11 px-4 py-2',
        sm: 'h-10 px-3.5',
        lg: 'h-12 px-8',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button };
