import type { ReactElement } from 'react';

export function CreatePage(): ReactElement {
  return (
    <article className="app-panel" data-testid="page-create">
      <h2 className="app-panel__title">Create Channel</h2>
      <p className="app-panel__copy">
        App shell route is ready. Create flow UI will be implemented in follow-up tasks.
      </p>
    </article>
  );
}
