import { type ReactElement, useEffect, useState } from 'react';

import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

const FALLBACK_MANIFEST_HASH = 'manifest-hash-unavailable';

export function normalizeManifestHash(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return FALLBACK_MANIFEST_HASH;
  }
  if (trimmed === FALLBACK_MANIFEST_HASH) {
    return FALLBACK_MANIFEST_HASH;
  }
  const isHex = /^[0-9a-f]{64}$/u.test(trimmed);
  return isHex ? trimmed : FALLBACK_MANIFEST_HASH;
}

export function ManifestInfo(): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [rawHash, setRawHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/manifest-hash.txt')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setRawHash(text);
      })
      .catch(() => {
        if (!cancelled) setRawHash(FALLBACK_MANIFEST_HASH);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const manifestHash = normalizeManifestHash(rawHash ?? FALLBACK_MANIFEST_HASH);
  const isAvailable = manifestHash !== FALLBACK_MANIFEST_HASH;
  const isLoading = rawHash === null;
  const shortHash = isLoading
    ? 'loading…'
    : isAvailable
      ? manifestHash.slice(0, 16)
      : FALLBACK_MANIFEST_HASH;

  return (
    <Card className="border-neon-cyan/20 bg-card/60" data-testid="manifest-info-card">
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="text-base text-neon-cyan">Build Manifest</CardTitle>
        <CardDescription>
          Verifiable release fingerprint for advanced integrity checks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Hash (first 8 bytes):{' '}
          <code
            className="rounded bg-muted px-2 py-1 text-xs text-foreground"
            data-testid="manifest-hash-short"
          >
            {shortHash}
          </code>
        </p>
        <Button
          className="h-8"
          data-testid="manifest-hash-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          size="sm"
          type="button"
          variant="secondary"
        >
          {expanded ? 'Hide full hash' : 'Show full hash'}
        </Button>
        {expanded ? (
          <pre
            className="overflow-x-auto rounded-lg border border-border/60 bg-secondary/40 p-3 text-xs text-foreground"
            data-testid="manifest-hash-full"
          >
            {manifestHash}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}
