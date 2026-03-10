const ENTRY_RECOVERY_KEY = 'zerolink-release-entry-reload-attempted';

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

export function clearEntryRecoveryAttempt(storage: Storage | null = getSessionStorage()): void {
  storage?.removeItem(ENTRY_RECOVERY_KEY);
}

export function recoverEntryMismatchOnce(
  storage: Storage | null = getSessionStorage(),
  reload: (() => void) | null = typeof window === 'undefined'
    ? null
    : () => window.location.reload()
): boolean {
  if (!storage || !reload) {
    return false;
  }
  if (storage.getItem(ENTRY_RECOVERY_KEY) === 'true') {
    return false;
  }

  storage.setItem(ENTRY_RECOVERY_KEY, 'true');
  reload();
  return true;
}
