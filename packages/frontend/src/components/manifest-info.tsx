import { type ReactElement, useState } from 'react';

import { getVerifiedReleaseSnapshot } from '../release/runtime';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

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
        <code className="block break-all rounded bg-secondary/40 px-2 py-1 text-xs text-foreground">
          {value}
        </code>
      ) : (
        <p className="text-sm text-foreground">{value}</p>
      )}
    </div>
  );
}

export function ManifestInfo(): ReactElement | null {
  const snapshot = getVerifiedReleaseSnapshot();
  const [expanded, setExpanded] = useState(false);

  if (!snapshot || snapshot.status !== 'verified') {
    return null;
  }

  return (
    <Card className="border-neon-cyan/20 bg-card/60" data-testid="manifest-info-card">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <CardTitle className="text-base text-neon-cyan">Verified Release</CardTitle>
            <CardDescription>
              This page matches an official ZeroLink release signed by our team.
            </CardDescription>
          </div>
          <Badge
            className="border-neon-green/30 bg-neon-green/10 px-3 py-1 text-neon-green"
            variant="secondary"
          >
            Verified
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Release fingerprint:{' '}
          <code className="rounded bg-muted px-2 py-1 text-xs text-foreground">
            {snapshot.manifestHash.slice(0, 16)}
          </code>
        </p>
        <Button
          className="h-8"
          onClick={() => setExpanded((current) => !current)}
          size="sm"
          type="button"
          variant="secondary"
        >
          {expanded ? 'Hide verification details' : 'View verification details'}
        </Button>
        {expanded ? (
          <div className="grid gap-3 rounded-lg border border-border/60 bg-secondary/20 p-3 md:grid-cols-2">
            <DetailRow label="Status" value="Verified" />
            <DetailRow label="App version" value={snapshot.version} />
            <DetailRow label="Build date" value={formatBuildDate(snapshot.buildTime)} />
            <DetailRow label="Commit" value={snapshot.commitHash} />
            <DetailRow label="Manifest hash" value={snapshot.manifestHash} code />
            <DetailRow label="Verified files" value={`${snapshot.verifiedFileCount}`} />
            <DetailRow
              label="Publisher key fingerprint"
              value={snapshot.publicKeyFingerprint}
              code
            />
            <DetailRow label="Signature" value={snapshot.signature} code />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
