import { SECURITY_PROFILE, type SecurityProfile } from '@zerolink/shared';
import { AlertTriangle, ClipboardCheck, Copy, PlusCircle } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StateNotice } from '../../components/layout';
import { type CreatedLinks, getChannelTtlLabel } from './helpers';

function useCopyLink(url: string) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [url]);

  return { copied, copy };
}

function CopyableLinkRow({
  label,
  url,
  testId,
  copyTestId,
  isManageLink = false,
}: {
  label: string;
  url: string;
  testId: string;
  copyTestId: string;
  isManageLink?: boolean;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyLink(url);

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {isManageLink ? (
          <a
            className="flex-1 break-all rounded-xl border border-border/60 bg-background/35 px-3 py-2 font-mono text-sm text-primary hover:text-foreground hover:underline"
            data-testid={testId}
            href={url}
          >
            {url}
          </a>
        ) : (
          <span
            className="flex-1 break-all rounded-xl border border-border/60 bg-background/35 px-3 py-2 font-mono text-sm text-primary"
            data-testid={testId}
          >
            {url}
          </span>
        )}
        <button
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          data-testid={copyTestId}
          onClick={() => void copy()}
          type="button"
        >
          {copied ? (
            <>
              <ClipboardCheck aria-hidden="true" className="size-3.5 text-emerald-200" />
              {t('create.copiedButton')}
            </>
          ) : (
            <>
              <Copy aria-hidden="true" className="size-3.5" />
              {t('create.copyButton')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function SuccessSummary({
  createdProfile,
  links,
  onCreateAnother,
}: {
  createdProfile: SecurityProfile | null;
  links: CreatedLinks | null;
  onCreateAnother: () => void;
}): ReactElement | null {
  const { t } = useTranslation();

  const profileLabelMap: Record<SecurityProfile, string> = useMemo(
    () => ({
      [SECURITY_PROFILE.QUICK]: t('profile.quick'),
      [SECURITY_PROFILE.SECURE]: t('profile.secure'),
    }),
    [t]
  );

  if (!createdProfile || !links) return null;

  return (
    <div
      className="space-y-5 rounded-2xl border border-emerald-300/20 bg-emerald-400/6 p-5"
      data-testid="create-success-summary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-base font-semibold text-emerald-200">{t('create.successTitle')}</p>
          <p className="text-sm text-muted-foreground">
            {t('create.successModeLabel')}{' '}
            <span className="font-medium text-foreground">{profileLabelMap[createdProfile]}</span>
            {links.isPasswordMode ? (
              <span
                className="ml-2 inline-block rounded-full border border-border/70 bg-background/30 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                data-testid="create-password-mode-badge"
              >
                {t('create.passwordProtectedBadge')}
              </span>
            ) : null}
          </p>
        </div>
        <button
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border/60 bg-card/60 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          data-testid="create-another-button"
          onClick={onCreateAnother}
          type="button"
        >
          <PlusCircle aria-hidden="true" className="size-3.5" />
          {t('create.createAnother')}
        </button>
      </div>

      <div className="space-y-4">
        <CopyableLinkRow
          copyTestId="create-success-share-link-copy"
          label={t('create.shareLinkLabel')}
          testId="create-success-share-link"
          url={links.shareUrlWithFragment}
        />
        <StateNotice
          data-testid="create-success-share-link-warning"
          title={t('create.shareLinkWarningTitle')}
          tone="warning"
        >
          <p className="mt-1 text-sm text-foreground/85">
            <AlertTriangle aria-hidden="true" className="mr-1 inline size-4" />
            {t('create.shareLinkWarningBody')}
          </p>
        </StateNotice>
        <CopyableLinkRow
          copyTestId="create-success-manage-link-copy"
          isManageLink
          label={t('create.manageLinkLabel')}
          testId="create-success-manage-link"
          url={links.manageUrl}
        />
        <p
          className="text-sm leading-6 text-muted-foreground"
          data-testid="create-success-expiry-hint"
        >
          {t('create.expiryHint', { duration: getChannelTtlLabel(t, links.ttl) })}
        </p>
      </div>
    </div>
  );
}
