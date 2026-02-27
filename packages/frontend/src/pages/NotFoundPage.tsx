import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardFooter,
  PageCardHeader,
  PageCardTitle,
  StateNotice,
} from '../components/layout';
import { Button } from '../components/ui/button';

export function NotFoundPage(): ReactElement {
  return (
    <PageCard data-testid="page-not-found" tone="orange">
      <PageCardHeader className="gap-2">
        <PageCardTitle asChild className="text-destructive">
          <h2>Page Not Found</h2>
        </PageCardTitle>
        <PageCardDescription>
          This route does not exist in the current app shell.
        </PageCardDescription>
      </PageCardHeader>
      <PageCardContent>
        <StateNotice data-testid="not-found-info" tone="info">
          Check the URL and try again.
        </StateNotice>
      </PageCardContent>
      <PageCardFooter>
        <Button asChild size="sm" variant="secondary">
          <Link to="/">Back to Create</Link>
        </Button>
      </PageCardFooter>
    </PageCard>
  );
}
