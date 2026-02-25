import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { Badge } from '../components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export function ManagePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();

  return (
    <Card className="border-border/70 bg-card/85" data-testid="page-manage">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-2xl text-primary">Manage / Deliver</CardTitle>
          <Badge className="border-primary/35 bg-primary/15 text-primary" variant="secondary">
            Sender
          </Badge>
        </div>
        <CardDescription className="text-muted-foreground">
          Sender-side page shell for verification, deliver, update, and delete.
        </CardDescription>
      </CardHeader>
      <p className="px-6 pb-6 text-sm text-muted-foreground">
        UUID:{' '}
        <code className="rounded bg-muted px-2 py-1 text-xs text-accent" data-testid="manage-uuid">
          {uuid ?? '(missing uuid)'}
        </code>
      </p>
    </Card>
  );
}
