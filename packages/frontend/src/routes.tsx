import { ROUTE_PATTERN } from '@zerolink/shared';
import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';
import { Link, Outlet, useLocation } from 'react-router-dom';

import { CreatePage } from './pages/CreatePage';
import { ManagePage } from './pages/ManagePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SharePage } from './pages/SharePage';

const DEMO_UUID = 'demo-channel-shell';

export const APP_ROUTE_ID = {
  SHELL: 'shell',
  CREATE: 'create',
  SHARE: 'share',
  MANAGE: 'manage',
  NOT_FOUND: 'not-found',
} as const;

function toChildPath(routePattern: string): string {
  return routePattern.startsWith('/') ? routePattern.slice(1) : routePattern;
}

function AppShellLayout(): ReactElement {
  const location = useLocation();
  const shareDemoPath = ROUTE_PATTERN.SHARE.replace(':uuid', DEMO_UUID);
  const manageDemoPath = ROUTE_PATTERN.MANAGE.replace(':uuid', DEMO_UUID);

  return (
    <main className="app-shell" data-testid="app-shell">
      <header className="app-shell__header">
        <h1 className="app-shell__title">ZeroLink</h1>
        <p className="app-shell__subtitle">Frontend app shell routing scaffold.</p>
        <nav aria-label="Primary">
          <ul className="app-shell__nav-list">
            <li>
              <Link className="app-shell__nav-link" to="/">
                Create
              </Link>
            </li>
            <li>
              <Link className="app-shell__nav-link" to={shareDemoPath}>
                Share
              </Link>
            </li>
            <li>
              <Link className="app-shell__nav-link" to={manageDemoPath}>
                Manage
              </Link>
            </li>
          </ul>
        </nav>
        <p className="app-shell__path">
          Current route:{' '}
          <code className="app-shell__path-code" data-testid="current-path">
            {location.pathname}
          </code>
        </p>
      </header>
      <section className="app-shell__content">
        <Outlet />
      </section>
    </main>
  );
}

export const APP_ROUTES: RouteObject[] = [
  {
    id: APP_ROUTE_ID.SHELL,
    path: '/',
    element: <AppShellLayout />,
    children: [
      {
        id: APP_ROUTE_ID.CREATE,
        index: true,
        element: <CreatePage />,
      },
      {
        id: APP_ROUTE_ID.SHARE,
        path: toChildPath(ROUTE_PATTERN.SHARE),
        element: <SharePage />,
      },
      {
        id: APP_ROUTE_ID.MANAGE,
        path: toChildPath(ROUTE_PATTERN.MANAGE),
        element: <ManagePage />,
      },
      {
        id: APP_ROUTE_ID.NOT_FOUND,
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
];
