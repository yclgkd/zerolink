const SHARE_LINK_SESSION_STORAGE_PREFIX = 'zerolink:created-share-link:';

/** Maximum age of a cached share link before it is considered expired (1 hour). */
export const SHARE_LINK_TTL_MS = 60 * 60 * 1000;

interface CachedEntry {
  url: string;
  ts: number;
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

export function persistCreatedShareLink(shareUrlWithFragment: string): void {
  const uuid = extractUuidFromShareUrl(shareUrlWithFragment);
  const storage = getSessionStorage();
  if (!uuid || !storage) {
    return;
  }

  try {
    const entry: CachedEntry = { url: shareUrlWithFragment, ts: Date.now() };
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
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'url' in parsed &&
      'ts' in parsed &&
      typeof (parsed as CachedEntry).url === 'string' &&
      typeof (parsed as CachedEntry).ts === 'number'
    ) {
      const entry = parsed as CachedEntry;
      if (Date.now() - entry.ts > SHARE_LINK_TTL_MS) {
        storage.removeItem(getShareLinkSessionStorageKey(uuid));
        return null;
      }
      return entry.url;
    }

    // Legacy plain-string fallback: treat as expired / invalid.
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
