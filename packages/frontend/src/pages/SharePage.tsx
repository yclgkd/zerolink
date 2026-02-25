import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

export function SharePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();

  return (
    <article className="app-panel" data-testid="page-share">
      <h2 className="app-panel__title">Share / Unlock</h2>
      <p className="app-panel__copy">Receiver-side page shell for lock and decrypt flows.</p>
      <p className="app-panel__meta">
        UUID:{' '}
        <code className="app-panel__code" data-testid="share-uuid">
          {uuid ?? '(missing uuid)'}
        </code>
      </p>
    </article>
  );
}
