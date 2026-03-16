import { Languages } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';

const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const currentLang = i18n.resolvedLanguage ?? i18n.language;
  const isZh = currentLang.startsWith('zh');
  const activeLang = isZh ? 'zh' : 'en';
  const activeLabel = activeLang === 'zh' ? '中文' : 'EN';

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-transparent px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        data-testid="lang-switcher-trigger"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <Languages aria-hidden="true" className="size-3.5" />
        {activeLabel}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[7rem] overflow-hidden rounded-xl border border-border/60 bg-slate-900/95 py-1 shadow-xl shadow-black/40 backdrop-blur-sm"
          role="menu"
        >
          {SUPPORTED_LANGUAGES.map(({ code, label }) => (
            <button
              aria-checked={activeLang === code}
              className={cn(
                'w-full px-3 py-2 text-left text-sm transition-colors',
                activeLang === code
                  ? 'font-medium text-primary'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              )}
              data-testid={`lang-switcher-${code}`}
              key={code}
              onClick={() => {
                void i18n.changeLanguage(code);
                setOpen(false);
              }}
              role="menuitemradio"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
