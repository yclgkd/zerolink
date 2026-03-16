import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardFooter,
  PageCardHeader,
  PageCardTitle,
} from '../components/layout';
import { Button } from '../components/ui/button';
import { hasTrustRouteReturnTo } from '../trust-route-state';

export function TrustPage(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const canReturnToPreviousRoute = hasTrustRouteReturnTo(location.state);

  const trustSections = [
    {
      title: t('trust.section1Title'),
      body: t('trust.section1Body'),
      accentClass: 'text-neon-cyan',
    },
    {
      title: t('trust.section2Title'),
      body: t('trust.section2Body'),
      accentClass: 'text-neon-magenta',
    },
    {
      title: t('trust.section3Title'),
      body: t('trust.section3Body'),
      accentClass: 'text-neon-green',
    },
    {
      title: t('trust.section4Title'),
      body: t('trust.section4Body'),
      accentClass: 'text-neon-orange',
    },
    {
      title: t('trust.section5Title'),
      body: t('trust.section5Body'),
      accentClass: 'text-neon-cyan',
    },
    {
      title: t('trust.section6Title'),
      body: t('trust.section6Body'),
      accentClass: 'text-neon-orange',
    },
  ];

  return (
    <PageCard data-testid="page-trust" tone="cyan">
      <PageCardHeader className="gap-2">
        <p className="text-xs uppercase tracking-[0.35em] text-neon-cyan/80">{t('trust.badge')}</p>
        <PageCardTitle asChild className="text-primary">
          <h2>{t('trust.title')}</h2>
        </PageCardTitle>
        <PageCardDescription>{t('trust.description')}</PageCardDescription>
      </PageCardHeader>
      <PageCardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {trustSections.map((section, index) => (
            <article
              className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-5 shadow-[0_18px_48px_rgb(0_0_0_/_0.2)]"
              key={section.title}
            >
              <p className={`text-xs uppercase tracking-[0.3em] ${section.accentClass}`}>
                {`0${index + 1}`}
              </p>
              <h3 className="mt-3 text-lg font-semibold text-foreground">{section.title}</h3>
              <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{section.body}</p>
            </article>
          ))}
        </div>
      </PageCardContent>
      <PageCardFooter className="flex flex-wrap gap-3">
        <Button
          data-testid="trust-back-button"
          onClick={() => {
            if (canReturnToPreviousRoute) {
              navigate(-1);
              return;
            }

            navigate('/');
          }}
          type="button"
          variant="secondary"
        >
          {t('trust.backButton')}
        </Button>
        <Button asChild data-testid="trust-create-button">
          <Link to="/">{t('trust.createButton')}</Link>
        </Button>
      </PageCardFooter>
    </PageCard>
  );
}
