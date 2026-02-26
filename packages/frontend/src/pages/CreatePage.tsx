import type { ReactElement } from 'react';

import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  RoleBadge,
} from '../components/layout';

export function CreatePage(): ReactElement {
  return (
    <PageCard data-testid="page-create" tone="purple">
      <PageCardHeader>
        <div className="flex items-center justify-between gap-3">
          <PageCardTitle asChild className="text-primary">
            <h2>Create Channel</h2>
          </PageCardTitle>
          <RoleBadge party="sender" />
        </div>
        <PageCardDescription>
          App shell route is ready. Create flow UI will be implemented in follow-up tasks.
        </PageCardDescription>
      </PageCardHeader>
      <PageCardContent>
        <p>Next task: wire Security Profile + form interactions.</p>
      </PageCardContent>
    </PageCard>
  );
}
