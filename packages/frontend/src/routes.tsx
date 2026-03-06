import { ROUTE_PATTERN } from '@zerolink/shared';
import { Link2 } from 'lucide-react';
import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';
import { Outlet } from 'react-router-dom';

import { ManifestInfo } from './components/manifest-info';
import { Card, CardHeader, CardTitle } from './components/ui/card';
import { CreatePage } from './pages/CreatePage';
import { ManagePage } from './pages/ManagePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SharePage } from './pages/SharePage';

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
  return (
    <main
      className="relative isolate mx-auto min-h-screen w-full max-w-5xl overflow-hidden px-4 py-8 md:px-6 md:py-10"
      data-testid="app-shell"
    >
      <Card className="border-border/70 bg-gradient-to-br from-secondary/60 via-card to-accent/70 backdrop-blur-xl">
        <CardHeader className="gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[var(--neon-magenta)] shadow-[0_0_20px_rgb(168_85_247_/_0.45)]">
              <Link2 aria-hidden className="size-5 text-white" />
            </div>
            <div>
              <CardTitle asChild className="text-3xl tracking-tight md:text-4xl">
                <h1>
                  Zero<span className="text-[var(--neon-orange)]">Link</span>
                </h1>
              </CardTitle>
              <p className="text-xs text-muted-foreground">Zero-Knowledge Secure Delivery</p>
            </div>
          </div>
        </CardHeader>
      </Card>
      <section className="mt-6 space-y-4 md:mt-8">
        <ManifestInfo />
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
