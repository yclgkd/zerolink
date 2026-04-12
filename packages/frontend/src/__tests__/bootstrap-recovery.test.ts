// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearEntryRecoveryAttempt, recoverEntryMismatchOnce } from '../bootstrap-recovery';

const ENTRY_RECOVERY_KEY = 'zerolink-release-entry-reload-attempted';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('clearEntryRecoveryAttempt', () => {
  it('removes the recovery marker from storage', () => {
    window.sessionStorage.setItem(ENTRY_RECOVERY_KEY, 'true');

    clearEntryRecoveryAttempt(window.sessionStorage);

    expect(window.sessionStorage.getItem(ENTRY_RECOVERY_KEY)).toBeNull();
  });
});

describe('recoverEntryMismatchOnce', () => {
  it('marks recovery once and reloads when storage and reload are available', () => {
    const reload = vi.fn();

    expect(recoverEntryMismatchOnce(window.sessionStorage, reload)).toBe(true);
    expect(window.sessionStorage.getItem(ENTRY_RECOVERY_KEY)).toBe('true');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('returns false when recovery already ran once', () => {
    window.sessionStorage.setItem(ENTRY_RECOVERY_KEY, 'true');
    const reload = vi.fn();

    expect(recoverEntryMismatchOnce(window.sessionStorage, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('returns false when storage is unavailable', () => {
    expect(recoverEntryMismatchOnce(null, vi.fn())).toBe(false);
  });

  it('returns false when reload is unavailable', () => {
    expect(recoverEntryMismatchOnce(window.sessionStorage, null)).toBe(false);
  });

  it('returns false when sessionStorage access throws', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');

    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('sessionStorage disabled');
      },
    });

    try {
      expect(recoverEntryMismatchOnce()).toBe(false);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, 'sessionStorage', originalDescriptor);
      }
    }
  });

  it('returns false when window is unavailable and default arguments resolve to null', () => {
    vi.stubGlobal('window', undefined);

    expect(recoverEntryMismatchOnce()).toBe(false);
  });
});
