import type { ReactElement } from 'react';

import { Badge } from '../components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export function CreatePage(): ReactElement {
  return (
    <Card className="border-border/70 bg-card/85" data-testid="page-create">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle asChild className="text-2xl text-primary">
            <h2>Create Channel</h2>
          </CardTitle>
          <Badge className="border-primary/35 bg-primary/15 text-primary" variant="secondary">
            Sender
          </Badge>
        </div>
        <CardDescription className="text-muted-foreground">
          App shell route is ready. Create flow UI will be implemented in follow-up tasks.
        </CardDescription>
      </CardHeader>
      <p className="px-6 pb-6 text-sm text-muted-foreground">
        Next task: wire Security Profile + form interactions.
      </p>
    </Card>
  );
}
