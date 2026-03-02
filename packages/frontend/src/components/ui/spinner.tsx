import { Loader2 } from 'lucide-react';

import { cn } from '../../lib/utils';

interface SpinnerProps {
  className?: string;
}

export function Spinner({ className }: SpinnerProps) {
  return <Loader2 aria-hidden="true" className={cn('size-4 animate-spin', className)} />;
}
