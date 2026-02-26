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

export function SharePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();

  return (
    <PageCard data-testid="page-share" tone="cyan">
      <PageCardHeader>
        <div className="flex items-center justify-between gap-3">
          <PageCardTitle asChild className="text-[var(--neon-cyan)]">
            <h2>Share / Unlock</h2>
          </PageCardTitle>
          <RoleBadge party="receiver" />
        </div>
        <PageCardDescription>
          Receiver-side page shell for lock and decrypt flows.
        </PageCardDescription>
      </PageCardHeader>
      <PageCardContent>
        <p>
          UUID:{' '}
          <code
            className="rounded bg-muted px-2 py-1 text-xs text-[var(--neon-cyan)]"
            data-testid="share-uuid"
          >
            {uuid ?? '(missing uuid)'}
          </code>
        </p>
      </PageCardContent>
    </PageCard>
  );
}
