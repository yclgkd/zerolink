import { buildShareUrlWithFragment, type ChannelTtlMs, parseShareFragment } from '@zerolink/shared';

const SHARE_LINK_SESSION_STORAGE_PREFIX = 'zerolink:created-share-link:';

interface CachedEntry {
  url: string;
  ts: number;
  ttl: ChannelTtlMs;
  lockSecret?: string;
  senderAuthFpr?: string;
}

interface ParsedShareUrl {
  uuid: string;
  sanitizedUrl: string;
  lockSecret: string | null;
  senderAuthFpr: string | null;
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getShareLinkSessionStorageKey(uuid: string): string {
  return `${SHARE_LINK_SESSION_STORAGE_PREFIX}${uuid}`;
}

function parseShareUrl(shareUrlWithFragment: string): ParsedShareUrl | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const url = new URL(shareUrlWithFragment, window.location.origin);
    const match = /^\/s\/([^/]+)$/u.exec(url.pathname);
    const uuid = match?.[1] ?? null;
    if (!uuid) {
      return null;
    }
    const { lockSecretB64u, senderAuthFpr } = parseShareFragment(url.hash);

    return {
      uuid,
      sanitizedUrl: `${url.pathname}${url.search}`,
      lockSecret: lockSecretB64u,
      senderAuthFpr,
    };
  } catch {
    return null;
  }
}

function parseCachedShareFragment(entry: Partial<CachedEntry>): {
  lockSecret: string | null;
  senderAuthFpr: string | null;
} {
  if (typeof entry.lockSecret !== 'string' || entry.lockSecret.length === 0) {
    return { lockSecret: null, senderAuthFpr: null };
  }

  const senderAuthParam =
    typeof entry.senderAuthFpr === 'string' && entry.senderAuthFpr.length > 0
      ? `&af=${entry.senderAuthFpr}`
      : '';
  const parsed = parseShareFragment(`#k=${entry.lockSecret}${senderAuthParam}`);
  return {
    lockSecret: parsed.lockSecretB64u,
    senderAuthFpr: parsed.senderAuthFpr,
  };
}

export function persistCreatedShareLink(shareUrlWithFragment: string, ttl: ChannelTtlMs): void {
  const parsedShareUrl = parseShareUrl(shareUrlWithFragment);
  const storage = getSessionStorage();
  if (!parsedShareUrl || !storage) {
    return;
  }

  try {
    const entry: CachedEntry = {
      url: parsedShareUrl.sanitizedUrl,
      ts: Date.now(),
      ttl,
      ...(parsedShareUrl.lockSecret ? { lockSecret: parsedShareUrl.lockSecret } : {}),
      ...(parsedShareUrl.senderAuthFpr ? { senderAuthFpr: parsedShareUrl.senderAuthFpr } : {}),
    };
    storage.setItem(getShareLinkSessionStorageKey(parsedShareUrl.uuid), JSON.stringify(entry));
  } catch {
    // Ignore storage failures so create success stays usable in restricted environments.
  }
}

export function readCreatedShareLink(uuid?: string): string | null {
  if (!uuid) {
    return null;
  }

  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(getShareLinkSessionStorageKey(uuid));
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const entry = parsed as Partial<CachedEntry>;
      if (
        typeof entry.url === 'string' &&
        typeof entry.ts === 'number' &&
        Number.isFinite(entry.ts) &&
        typeof entry.ttl === 'number' &&
        Number.isFinite(entry.ttl) &&
        entry.ttl > 0
      ) {
        const parsedShareUrl = parseShareUrl(entry.url);
        if (!parsedShareUrl || parsedShareUrl.uuid !== uuid) {
          storage.removeItem(getShareLinkSessionStorageKey(uuid));
          return null;
        }
        if (Date.now() - entry.ts > entry.ttl) {
          storage.removeItem(getShareLinkSessionStorageKey(uuid));
          return null;
        }

        const cachedFragment = parsedShareUrl.lockSecret
          ? {
              lockSecret: parsedShareUrl.lockSecret,
              senderAuthFpr: parsedShareUrl.senderAuthFpr,
            }
          : parseCachedShareFragment(entry);
        if (!cachedFragment.lockSecret) {
          storage.removeItem(getShareLinkSessionStorageKey(uuid));
          return null;
        }

        const sanitizedEntry: CachedEntry = {
          url: parsedShareUrl.sanitizedUrl,
          ts: entry.ts,
          ttl: entry.ttl,
          lockSecret: cachedFragment.lockSecret,
          ...(cachedFragment.senderAuthFpr ? { senderAuthFpr: cachedFragment.senderAuthFpr } : {}),
        };

        if (
          entry.url !== sanitizedEntry.url ||
          entry.lockSecret !== sanitizedEntry.lockSecret ||
          entry.senderAuthFpr !== sanitizedEntry.senderAuthFpr
        ) {
          storage.setItem(getShareLinkSessionStorageKey(uuid), JSON.stringify(sanitizedEntry));
        }

        return buildShareUrlWithFragment(
          parsedShareUrl.sanitizedUrl,
          cachedFragment.lockSecret,
          cachedFragment.senderAuthFpr ?? undefined
        );
      }
    }

    // Legacy or malformed entries are treated as invalid and cleaned up.
    storage.removeItem(getShareLinkSessionStorageKey(uuid));
    return null;
  } catch {
    // Entry is corrupted or unparseable; best-effort cleanup.
    try {
      storage.removeItem(getShareLinkSessionStorageKey(uuid));
    } catch {
      // Ignore cleanup failures.
    }
    return null;
  }
}

export function clearCreatedShareLink(uuid?: string): void {
  if (!uuid) {
    return;
  }

  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(getShareLinkSessionStorageKey(uuid));
  } catch {
    // Ignore cleanup failures because the cache is best-effort only.
  }
}
