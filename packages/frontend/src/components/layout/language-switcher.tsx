import { Languages } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';

const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', triggerLabel: 'EN' },
  { code: 'zh', label: '中文', triggerLabel: '中文' },
  { code: 'ja', label: '日本語', triggerLabel: '日本語' },
  { code: 'de', label: 'Deutsch', triggerLabel: 'DE' },
  { code: 'fr', label: 'Français', triggerLabel: 'FR' },
  { code: 'es', label: 'Español', triggerLabel: 'ES' },
  { code: 'ru', label: 'Русский', triggerLabel: 'RU' },
] as const;

function resolveActiveLanguage(language?: string) {
  const normalized = language?.toLowerCase() ?? '';
  return (
    SUPPORTED_LANGUAGES.find(
      ({ code }) => normalized === code || normalized.startsWith(`${code}-`)
    ) ?? SUPPORTED_LANGUAGES[0]
  );
}

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const currentLang = i18n.resolvedLanguage ?? i18n.language;
  const activeLanguage = resolveActiveLanguage(currentLang);

  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownStyle({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        if (!dropdownRef.current) return;
        const activeItem = dropdownRef.current.querySelector(
          '[aria-checked="true"]'
        ) as HTMLElement | null;
        const firstItem = dropdownRef.current.querySelector('button') as HTMLElement | null;
        (activeItem ?? firstItem)?.focus();
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClose(event: MouseEvent) {
      const target = event.target as Node;
      const insideTrigger = triggerRef.current?.contains(target) ?? false;
      const insideDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insideDropdown) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClose);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClose);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!dropdownRef.current) return;
    const items = Array.from(
      dropdownRef.current.querySelectorAll('button[role="menuitemradio"]')
    ) as HTMLElement[];
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % items.length;
      items[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + items.length) % items.length;
      items[prevIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      // Return focus to the trigger without preventing default,
      // allowing the browser to natively tab to the next logical DOM element (e.g. Trust Model button)
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('lang.switcherLabel')}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border/50 bg-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        data-testid="lang-switcher-trigger"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <Languages aria-hidden="true" className="size-4" />
        {activeLanguage.triggerLabel}
      </button>

      {open
        ? createPortal(
            <div
              className="fixed z-[9999] min-w-[7rem] overflow-hidden rounded-xl border border-border/60 bg-slate-900/95 py-1 shadow-xl shadow-black/40 backdrop-blur-sm"
              onKeyDown={handleMenuKeyDown}
              ref={dropdownRef}
              aria-label={t('lang.menuLabel')}
              role="menu"
              style={{ top: dropdownStyle.top, right: dropdownStyle.right }}
            >
              {SUPPORTED_LANGUAGES.map(({ code, label }) => (
                <button
                  aria-checked={activeLanguage.code === code}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm transition-colors focus:outline-none focus:bg-white/10',
                    activeLanguage.code === code
                      ? 'font-medium text-primary'
                      : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                  )}
                  data-testid={`lang-switcher-${code}`}
                  key={code}
                  onClick={() => {
                    void i18n.changeLanguage(code);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  role="menuitemradio"
                  tabIndex={-1}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
