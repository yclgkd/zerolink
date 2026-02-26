import { describe, expect, it } from 'vitest';

import { buttonVariants } from '../components/ui/button';

describe('button variants', () => {
  it('includes danger variant with destructive token classes', () => {
    const classes = buttonVariants({ variant: 'danger' });

    expect(classes).toContain('text-destructive');
    expect(classes).toContain('border-destructive/50');
    expect(classes).toContain('bg-destructive/10');
  });

  it('keeps default variant styles', () => {
    const classes = buttonVariants({ variant: 'default' });

    expect(classes).toContain('bg-primary');
    expect(classes).toContain('text-primary-foreground');
  });
});
