import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

export function ManagePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();

  return (
    <article data-testid="page-manage">
      <h2>Manage / Deliver</h2>
      <p>Sender-side page shell for verification, deliver, update, and delete.</p>
      <p>
        UUID: <code data-testid="manage-uuid">{uuid ?? '(missing uuid)'}</code>
      </p>
    </article>
  );
}
