import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

export function ManagePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();

  return (
    <article className="app-panel" data-testid="page-manage">
      <h2 className="app-panel__title">Manage / Deliver</h2>
      <p className="app-panel__copy">
        Sender-side page shell for verification, deliver, update, and delete.
      </p>
      <p className="app-panel__meta">
        UUID:{' '}
        <code className="app-panel__code" data-testid="manage-uuid">
          {uuid ?? '(missing uuid)'}
        </code>
      </p>
    </article>
  );
}
