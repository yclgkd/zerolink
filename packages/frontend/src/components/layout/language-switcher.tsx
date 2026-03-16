import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';

const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中' },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const currentLang = i18n.resolvedLanguage ?? i18n.language;
  const isZh = currentLang.startsWith('zh');
  const activeLang = isZh ? 'zh' : 'en';

  return (
    <div className="flex items-center gap-1" aria-label="Language" role="toolbar">
      {SUPPORTED_LANGUAGES.map(({ code, label }) => (
        <button
          aria-pressed={activeLang === code}
          className={cn(
            'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
            activeLang === code
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-border/50 bg-transparent text-muted-foreground hover:border-border hover:text-foreground'
          )}
          data-testid={`lang-switcher-${code}`}
          key={code}
          onClick={() => void i18n.changeLanguage(code)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
