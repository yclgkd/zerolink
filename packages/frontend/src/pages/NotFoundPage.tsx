import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '../components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';

export function NotFoundPage(): ReactElement {
  return (
    <Card className="border-border/70 bg-card/85" data-testid="page-not-found">
      <CardHeader className="gap-2">
        <CardTitle className="text-2xl text-destructive">Page Not Found</CardTitle>
        <CardDescription className="text-muted-foreground">
          Check the URL and try again.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild size="sm" variant="secondary">
          <Link to="/">Back to Create</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
