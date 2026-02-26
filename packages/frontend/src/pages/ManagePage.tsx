import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  RoleBadge,
} from '../components/layout';

export function ManagePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();

  return (
    <PageCard data-testid="page-manage" tone="purple">
      <PageCardHeader>
        <div className="flex items-center justify-between gap-3">
          <PageCardTitle asChild className="text-primary">
            <h2>Manage / Deliver</h2>
          </PageCardTitle>
          <RoleBadge party="sender" />
        </div>
        <PageCardDescription>
          Sender-side page shell for verification, deliver, update, and delete.
        </PageCardDescription>
      </PageCardHeader>
      <PageCardContent>
        <p>
          UUID:{' '}
          <code
            className="rounded bg-muted px-2 py-1 text-xs text-accent"
            data-testid="manage-uuid"
          >
            {uuid ?? '(missing uuid)'}
          </code>
        </p>
      </PageCardContent>
    </PageCard>
  );
}
