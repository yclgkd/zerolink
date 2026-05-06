import { ArrowUpRight, Github } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { REPOSITORY_URL } from '../../lib/repository';

export function AppShellFooter(): ReactElement {
  const { t } = useTranslation();

  return (
    <footer className="mt-8 flex justify-center pb-2 md:mt-10 md:pb-0">
      <a
        className="group inline-flex items-center gap-2 rounded-full border border-border/55 bg-card/35 px-3.5 py-2 text-xs text-muted-foreground transition-[border-color,background-color,color,transform] duration-200 hover:border-primary/24 hover:bg-card/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="app-shell-repo-link"
        href={REPOSITORY_URL}
        rel="noreferrer"
        target="_blank"
      >
        <Github aria-hidden="true" className="size-3.5" />
        <span>{t('shell.sourceCode')}</span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-3.5 opacity-65 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        />
      </a>
    </footer>
  );
}
