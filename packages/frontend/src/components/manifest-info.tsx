import { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getVerifiedReleaseSnapshot } from '../release/runtime';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

function formatBuildDate(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  })}, ${date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`;
}

function DetailRow({
  label,
  value,
  code = false,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      {code ? (
        <code className="block break-all rounded bg-secondary/40 px-2 py-1 text-sm leading-6 text-foreground">
          {value}
        </code>
      ) : (
        <p className="text-sm text-foreground">{value}</p>
      )}
    </div>
  );
}

export function ManifestInfo(): ReactElement | null {
  const { t } = useTranslation();
  const snapshot = getVerifiedReleaseSnapshot();
  const [expanded, setExpanded] = useState(false);

  if (!snapshot || snapshot.status !== 'verified') {
    return null;
  }

  return (
    <Card className="border-sky-300/14 bg-card/55 shadow-none" data-testid="manifest-info-card">
      <CardHeader className="gap-3 py-3 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle asChild className="text-sm font-semibold text-primary">
            <h2>{t('manifest.title')}</h2>
          </CardTitle>
          <Badge
            className="border-emerald-300/24 bg-emerald-400/8 px-3 py-1 text-emerald-200"
            variant="secondary"
          >
            {t('manifest.verifiedBadge')}
          </Badge>
        </div>
        <p className="max-w-[42rem] text-sm leading-6 text-muted-foreground">
          {t('manifest.body')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('manifest.fingerprintLabel')}</span>
          <code className="rounded-lg border border-border/60 bg-background/35 px-2 py-1 text-sm text-foreground/90">
            {snapshot.manifestHash.slice(0, 16)}
          </code>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <Button
          className="w-full text-sm sm:w-auto"
          onClick={() => setExpanded((current) => !current)}
          size="sm"
          type="button"
          variant="secondary"
        >
          {expanded ? t('manifest.hideDetails') : t('manifest.showDetails')}
        </Button>
        {expanded ? (
          <div className="grid gap-3 rounded-2xl border border-border/60 bg-secondary/20 p-3 md:grid-cols-2">
            <DetailRow label={t('manifest.statusLabel')} value={t('manifest.verifiedBadge')} />
            <DetailRow label={t('manifest.versionLabel')} value={snapshot.version} />
            <DetailRow
              label={t('manifest.buildDateLabel')}
              value={formatBuildDate(snapshot.buildTime)}
            />
            <DetailRow label={t('manifest.commitLabel')} value={snapshot.commitHash} />
            <DetailRow label={t('manifest.manifestHashLabel')} value={snapshot.manifestHash} code />
            <DetailRow label={t('manifest.filesLabel')} value={`${snapshot.verifiedFileCount}`} />
            <DetailRow
              label={t('manifest.publisherKeyLabel')}
              value={snapshot.publicKeyFingerprint}
              code
            />
            <DetailRow label={t('manifest.signatureLabel')} value={snapshot.signature} code />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
