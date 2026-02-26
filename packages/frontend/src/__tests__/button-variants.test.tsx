import { describe, expect, it } from 'vitest';

import { buttonVariants } from '../components/ui/button';

describe('button variants', () => {
  it('includes danger variant styles', () => {
    const classes = buttonVariants({ variant: 'danger' });

    expect(classes).toContain('text-[#ef4444]');
    expect(classes).toContain('border-[color:rgb(239_68_68_/_0.5)]');
    expect(classes).toContain('bg-[color:rgb(239_68_68_/_0.1)]');
  });

  it('keeps default variant styles', () => {
    const classes = buttonVariants({ variant: 'default' });

    expect(classes).toContain('bg-primary');
    expect(classes).toContain('text-primary-foreground');
  });
});
