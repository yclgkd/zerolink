import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

export function SharePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();

  return (
    <article data-testid="page-share">
      <h2>Share / Unlock</h2>
      <p>Receiver-side page shell for lock and decrypt flows.</p>
      <p>
        UUID: <code data-testid="share-uuid">{uuid ?? '(missing uuid)'}</code>
      </p>
    </article>
  );
}
