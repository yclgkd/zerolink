import type { ReactElement } from 'react';

export function NotFoundPage(): ReactElement {
  return (
    <article className="app-panel" data-testid="page-not-found">
      <h2 className="app-panel__title">Page Not Found</h2>
      <p className="app-panel__copy">Check the URL and try again.</p>
    </article>
  );
}
