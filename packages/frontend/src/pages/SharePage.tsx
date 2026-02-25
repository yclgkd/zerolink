import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { Badge } from '../components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export function SharePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();

  return (
    <Card className="border-border/70 bg-card/85" data-testid="page-share">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-2xl text-[var(--neon-cyan)]">Share / Unlock</CardTitle>
          <Badge
            className="border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]"
            variant="secondary"
          >
            Receiver
          </Badge>
        </div>
        <CardDescription className="text-muted-foreground">
          Receiver-side page shell for lock and decrypt flows.
        </CardDescription>
      </CardHeader>
      <p className="px-6 pb-6 text-sm text-muted-foreground">
        UUID:{' '}
        <code
          className="rounded bg-muted px-2 py-1 text-xs text-[var(--neon-cyan)]"
          data-testid="share-uuid"
        >
          {uuid ?? '(missing uuid)'}
        </code>
      </p>
    </Card>
  );
}
