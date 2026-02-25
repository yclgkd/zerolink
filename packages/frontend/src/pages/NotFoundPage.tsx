import type { ReactElement } from 'react';

export function NotFoundPage(): ReactElement {
  return (
    <article data-testid="page-not-found">
      <h2>Page Not Found</h2>
      <p>Check the URL and try again.</p>
    </article>
  );
}
