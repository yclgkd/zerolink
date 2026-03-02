import { ROUTE_PATTERN } from '@zerolink/shared';
import { ExternalLink, Link2, Plus, Settings } from 'lucide-react';
import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { ManifestInfo } from './components/manifest-info';
import { Badge } from './components/ui/badge';
import { buttonVariants } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { cn } from './lib/utils';
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

function navLinkClassName(isActive: boolean): string {
  return cn(
    buttonVariants({ variant: 'outline', size: 'sm' }),
    'rounded-full border-border/80 bg-card/70 text-muted-foreground shadow-[0_0_0_rgb(0_0_0_/_0)] transition-all hover:-translate-y-0.5 hover:border-ring/70 hover:text-foreground hover:shadow-[0_0_24px_rgb(6_182_212_/_0.22)]',
    isActive && 'border-primary/80 text-foreground shadow-[0_0_20px_rgb(168_85_247_/_0.3)]'
  );
}

function AppShellLayout(): ReactElement {
  const location = useLocation();
  const shareDemoPath = ROUTE_PATTERN.SHARE.replace(':uuid', DEMO_UUID);
  const manageDemoPath = ROUTE_PATTERN.MANAGE.replace(':uuid', DEMO_UUID);

  return (
    <main
      className="relative isolate mx-auto min-h-screen w-full max-w-5xl overflow-hidden px-4 py-8 md:px-6 md:py-10"
      data-testid="app-shell"
    >
      <Card className="border-border/70 bg-gradient-to-br from-secondary/60 via-card to-accent/70 backdrop-blur-xl">
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
            <Badge
              className="border border-primary/30 bg-secondary text-secondary-foreground"
              variant="secondary"
            >
              App Shell
            </Badge>
          </div>
          <CardDescription className="text-base text-muted-foreground">
            Frontend app shell routing scaffold.
          </CardDescription>
          <nav aria-label="Primary">
            <ul className="flex flex-wrap gap-3">
              <li>
                <NavLink className={({ isActive }) => navLinkClassName(isActive)} end to="/">
                  <Plus aria-hidden="true" className="size-3.5" />
                  Create
                </NavLink>
              </li>
              <li>
                <NavLink
                  className={({ isActive }) => navLinkClassName(isActive)}
                  to={shareDemoPath}
                >
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                  Share
                </NavLink>
              </li>
              <li>
                <NavLink
                  className={({ isActive }) => navLinkClassName(isActive)}
                  to={manageDemoPath}
                >
                  <Settings aria-hidden="true" className="size-3.5" />
                  Manage
                </NavLink>
              </li>
            </ul>
          </nav>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            Current route:{' '}
            <code
              className="rounded bg-muted px-2 py-1 text-xs text-[var(--neon-cyan)]"
              data-testid="current-path"
            >
              {location.pathname}
            </code>
          </p>
        </CardContent>
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
