import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import {
  PageCard,
  PageCardDescription,
  PageCardFooter,
  PageCardHeader,
  PageCardTitle,
} from '../components/layout';
import { Button } from '../components/ui/button';

export function NotFoundPage(): ReactElement {
  return (
    <PageCard data-testid="page-not-found" tone="orange">
      <PageCardHeader className="gap-2">
        <PageCardTitle asChild className="text-destructive">
          <h2>Page Not Found</h2>
        </PageCardTitle>
        <PageCardDescription>Check the URL and try again.</PageCardDescription>
      </PageCardHeader>
      <PageCardFooter>
        <Button asChild size="sm" variant="secondary">
          <Link to="/">Back to Create</Link>
        </Button>
      </PageCardFooter>
    </PageCard>
  );
}
