const SHARE_LINK_SESSION_STORAGE_PREFIX = 'zerolink:created-share-link:';

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
    storage.setItem(getShareLinkSessionStorageKey(uuid), shareUrlWithFragment);
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
    return storage.getItem(getShareLinkSessionStorageKey(uuid));
  } catch {
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
