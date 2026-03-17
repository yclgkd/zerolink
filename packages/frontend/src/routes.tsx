import { ROUTE_PATTERN } from '@zerolink/shared';
import { Link2, X } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RouteObject } from 'react-router-dom';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';

import { LanguageSwitcher } from './components/layout/language-switcher';
import { ManifestInfo } from './components/manifest-info';
import { Button } from './components/ui/button';
import { Card, CardHeader, CardTitle } from './components/ui/card';
import { CreatePage } from './pages/CreatePage';
import { ManagePage } from './pages/ManagePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SharePage } from './pages/SharePage';
import { TrustPage } from './pages/TrustPage';
import { createTrustRouteState } from './trust-route-state';

export const APP_ROUTE_ID = {
  SHELL: 'shell',
  CREATE: 'create',
  SHARE: 'share',
  MANAGE: 'manage',
  TRUST: 'trust',
  NOT_FOUND: 'not-found',
} as const;

const TRUST_PAGE_PATH = 'trust' as const;

function toChildPath(routePattern: string): string {
  return routePattern.startsWith('/') ? routePattern.slice(1) : routePattern;
}

const IN_APP_BROWSER_DISMISSED_KEY = 'zl-inapp-dismissed';

function AppShellLayout(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const isTrustRoute = location.pathname === `/${TRUST_PAGE_PATH}`;
  const trustRouteState = createTrustRouteState(location);
  const [showInAppWarning, setShowInAppWarning] = useState(
    () => sessionStorage.getItem(IN_APP_BROWSER_DISMISSED_KEY) !== '1'
  );

  const handleDismissInAppWarning = () => {
    sessionStorage.setItem(IN_APP_BROWSER_DISMISSED_KEY, '1');
    setShowInAppWarning(false);
  };

  return (
    <main
      className="relative isolate mx-auto min-h-screen w-full max-w-6xl overflow-x-hidden px-4 py-8 md:px-8 md:py-10"
      data-testid="app-shell"
    >
      <Toaster position="bottom-right" richColors />
      <Card className="sticky top-4 z-50 border-white/8 bg-slate-900/75 backdrop-blur-2xl">
        <CardHeader className="flex-col gap-2 py-4">
          {showInAppWarning ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300"
              data-testid="inapp-browser-warning"
            >
              <span className="flex-1">{t('shell.inAppBrowserWarning')}</span>
              <button
                aria-label="Dismiss"
                className="mt-0.5 shrink-0 text-yellow-400 hover:text-yellow-200"
                data-testid="inapp-browser-warning-dismiss"
                onClick={handleDismissInAppWarning}
                type="button"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[var(--neon-magenta)] shadow-[0_0_20px_rgb(168_85_247_/_0.45)]">
                <Link2 aria-hidden="true" className="size-5 text-white" />
              </div>
              <div>
                <CardTitle asChild className="text-3xl tracking-tight md:text-4xl">
                  <h1>
                    Zero<span className="text-[var(--neon-orange)]">Link</span>
                  </h1>
                </CardTitle>
                <p className="text-xs text-muted-foreground">{t('shell.tagline')}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-center">
              <LanguageSwitcher />
              <Button asChild size="sm" variant="outline">
                {isTrustRoute ? (
                  <Link data-testid="app-shell-back-link" to="/">
                    {t('shell.backToCreate')}
                  </Link>
                ) : (
                  <Link
                    data-testid="app-shell-trust-link"
                    state={trustRouteState}
                    to={`/${TRUST_PAGE_PATH}`}
                  >
                    {t('shell.trustModelLink')}
                  </Link>
                )}
              </Button>
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
        id: APP_ROUTE_ID.TRUST,
        path: TRUST_PAGE_PATH,
        element: <TrustPage />,
      },
      {
        id: APP_ROUTE_ID.NOT_FOUND,
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
];
