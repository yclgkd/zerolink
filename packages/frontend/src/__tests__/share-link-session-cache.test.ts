// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCreatedShareLink,
  persistCreatedShareLink,
  readCreatedShareLink,
  SHARE_LINK_TTL_MS,
} from '../pages/create/share-link-session-cache';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const SHARE_URL = `/s/${UUID}#k=bW9ja19sb2NrX3NlY3JldA`;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('persistCreatedShareLink', () => {
  it('writes a JSON entry keyed by uuid extracted from the share URL', () => {
    persistCreatedShareLink(SHARE_URL);

    const raw = window.sessionStorage.getItem(`zerolink:created-share-link:${UUID}`);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(String(raw));
    expect(parsed.url).toBe(SHARE_URL);
    expect(typeof parsed.ts).toBe('number');
  });

  it('ignores URLs that do not match the /s/:uuid pattern', () => {
    persistCreatedShareLink('/invalid/path');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('ignores completely invalid URLs', () => {
    persistCreatedShareLink(':::not-a-url');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('silently ignores storage write failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => persistCreatedShareLink(SHARE_URL)).not.toThrow();
  });
});

describe('readCreatedShareLink', () => {
  it('returns the URL when a valid non-expired entry exists', () => {
    persistCreatedShareLink(SHARE_URL);
    expect(readCreatedShareLink(UUID)).toBe(SHARE_URL);
  });

  it('returns null when no entry exists for the uuid', () => {
    expect(readCreatedShareLink(UUID)).toBeNull();
  });

  it('returns null when uuid is undefined', () => {
    expect(readCreatedShareLink(undefined)).toBeNull();
  });

  it('returns null and removes the entry when TTL has expired', () => {
    persistCreatedShareLink(SHARE_URL);

    // Advance past TTL
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + SHARE_LINK_TTL_MS + 1);

    expect(readCreatedShareLink(UUID)).toBeNull();
    expect(window.sessionStorage.getItem(`zerolink:created-share-link:${UUID}`)).toBeNull();
  });

  it('returns null and removes legacy plain-string entries', () => {
    window.sessionStorage.setItem(`zerolink:created-share-link:${UUID}`, SHARE_URL);

    expect(readCreatedShareLink(UUID)).toBeNull();
    expect(window.sessionStorage.getItem(`zerolink:created-share-link:${UUID}`)).toBeNull();
  });

  it('returns null when stored JSON is malformed', () => {
    window.sessionStorage.setItem(`zerolink:created-share-link:${UUID}`, '{bad json');

    expect(readCreatedShareLink(UUID)).toBeNull();
  });

  it('silently returns null when storage read throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(readCreatedShareLink(UUID)).toBeNull();
  });
});

describe('clearCreatedShareLink', () => {
  it('removes the entry for the given uuid', () => {
    persistCreatedShareLink(SHARE_URL);
    expect(window.sessionStorage.length).toBe(1);

    clearCreatedShareLink(UUID);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('does nothing when uuid is undefined', () => {
    persistCreatedShareLink(SHARE_URL);
    clearCreatedShareLink(undefined);
    expect(window.sessionStorage.length).toBe(1);
  });

  it('does nothing when the entry does not exist', () => {
    expect(() => clearCreatedShareLink(UUID)).not.toThrow();
  });

  it('silently ignores storage removal failures', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(() => clearCreatedShareLink(UUID)).not.toThrow();
  });
});
