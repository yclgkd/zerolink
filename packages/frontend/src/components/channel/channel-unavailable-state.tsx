import type { ReactElement } from 'react';

interface ChannelUnavailableStateProps {
  body: string;
  testId: string;
}

export function ChannelUnavailableState({
  body,
  testId,
}: ChannelUnavailableStateProps): ReactElement {
  return (
    <section className="space-y-2" data-testid={testId}>
      <h3 className="text-base font-semibold text-foreground">Channel Unavailable</h3>
      <p className="text-xs text-muted-foreground">{body}</p>
    </section>
  );
}
