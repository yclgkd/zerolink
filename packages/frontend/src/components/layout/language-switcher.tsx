import { Languages } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-transparent px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        data-testid="lang-switcher-trigger"
        onClick={() => setOpen((prev) => !prev)}
        ref={triggerRef}
        type="button"
      >
        <Languages aria-hidden="true" className="size-3.5" />
        {activeLabel}
      </button>

      {open
        ? createPortal(
            <div
              className="fixed z-[9999] min-w-[7rem] overflow-hidden rounded-xl border border-border/60 bg-slate-900/95 py-1 shadow-xl shadow-black/40 backdrop-blur-sm"
              ref={dropdownRef}
              role="menu"
              style={{ top: dropdownStyle.top, right: dropdownStyle.right }}
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
            </div>,
            document.body
          )
        : null}
    </>
  );
}
