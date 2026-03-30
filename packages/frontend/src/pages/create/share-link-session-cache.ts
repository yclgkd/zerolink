import type { ChannelTtlMs } from '@zerolink/shared';

const SHARE_LINK_SESSION_STORAGE_PREFIX = 'zerolink:created-share-link:';

interface CachedEntry {
  url: string;
  ts: number;
  ttl: ChannelTtlMs;
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

function extractUuidFromShareUrl(shareUrlWithFragment: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const url = new URL(shareUrlWithFragment, window.location.origin);
    const match = /^\/s\/([^/]+)$/u.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function persistCreatedShareLink(shareUrlWithFragment: string, ttl: ChannelTtlMs): void {
  const uuid = extractUuidFromShareUrl(shareUrlWithFragment);
  const storage = getSessionStorage();
  if (!uuid || !storage) {
    return;
  }

  try {
    const entry: CachedEntry = { url: shareUrlWithFragment, ts: Date.now(), ttl };
    storage.setItem(getShareLinkSessionStorageKey(uuid), JSON.stringify(entry));
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
        if (Date.now() - entry.ts > entry.ttl) {
          storage.removeItem(getShareLinkSessionStorageKey(uuid));
          return null;
        }

        return entry.url;
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
