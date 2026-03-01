// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManifestInfo, normalizeManifestHash } from '../components/manifest-info';

const VALID_HASH = 'a3f1e2d4b5c60789a3f1e2d4b5c60789a3f1e2d4b5c60789a3f1e2d4b5c60789';

function mockFetchWith(response: Response): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

function mockFetchRejected(): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('normalizeManifestHash', () => {
  it('returns fallback for empty string', () => {
    expect(normalizeManifestHash('')).toBe('manifest-hash-unavailable');
  });

  it('returns fallback for whitespace-only string', () => {
    expect(normalizeManifestHash('   ')).toBe('manifest-hash-unavailable');
  });

  it('returns fallback for the fallback literal', () => {
    expect(normalizeManifestHash('manifest-hash-unavailable')).toBe('manifest-hash-unavailable');
  });

  it('returns fallback for non-hex string', () => {
    expect(normalizeManifestHash('not-a-hex-value')).toBe('manifest-hash-unavailable');
  });

  it('returns fallback for hex string shorter than 64 chars', () => {
    expect(normalizeManifestHash('deadbeef')).toBe('manifest-hash-unavailable');
  });

  it('returns fallback for hex string longer than 64 chars', () => {
    expect(normalizeManifestHash(`${VALID_HASH}00`)).toBe('manifest-hash-unavailable');
  });

  it('returns normalised lowercase hex for valid hash', () => {
    expect(normalizeManifestHash(VALID_HASH)).toBe(VALID_HASH);
  });

  it('normalises uppercase hex to lowercase', () => {
    expect(normalizeManifestHash(VALID_HASH.toUpperCase())).toBe(VALID_HASH);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(normalizeManifestHash(`  ${VALID_HASH}\n`)).toBe(VALID_HASH);
  });
});

describe('ManifestInfo', () => {
  beforeEach(() => {
    cleanup();
  });

  it('shows loading state before fetch resolves', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise(() => {})) // never resolves
    );
    render(<ManifestInfo />);

    expect(screen.getByTestId('manifest-hash-short').textContent).toBe('loading…');
  });

  it('shows valid hash after successful fetch', async () => {
    mockFetchWith(new Response(`${VALID_HASH}\n`, { status: 200 }));
    render(<ManifestInfo />);

    await waitFor(() => {
      expect(screen.getByTestId('manifest-hash-short').textContent).toBe(VALID_HASH.slice(0, 16));
    });
  });

  it('shows fallback when fetch returns 4xx (r.ok is false)', async () => {
    mockFetchWith(new Response('Not Found', { status: 404 }));
    render(<ManifestInfo />);

    await waitFor(() => {
      expect(screen.getByTestId('manifest-hash-short').textContent).toBe(
        'manifest-hash-unavailable'
      );
    });
  });

  it('shows fallback when fetch returns non-hex content', async () => {
    mockFetchWith(new Response('not-a-hash\n', { status: 200 }));
    render(<ManifestInfo />);

    await waitFor(() => {
      expect(screen.getByTestId('manifest-hash-short').textContent).toBe(
        'manifest-hash-unavailable'
      );
    });
  });

  it('shows fallback when fetch rejects (network error)', async () => {
    mockFetchRejected();
    render(<ManifestInfo />);

    await waitFor(() => {
      expect(screen.getByTestId('manifest-hash-short').textContent).toBe(
        'manifest-hash-unavailable'
      );
    });
  });

  it('renders fallback and toggles full hash (legacy fallback path)', async () => {
    mockFetchWith(new Response('manifest-hash-unavailable\n', { status: 200 }));
    render(<ManifestInfo />);

    await waitFor(() => {
      expect(screen.getByTestId('manifest-hash-short').textContent).toBe(
        'manifest-hash-unavailable'
      );
    });

    expect(screen.queryByTestId('manifest-hash-full')).toBeNull();

    fireEvent.click(screen.getByTestId('manifest-hash-toggle'));

    expect(screen.getByTestId('manifest-hash-full').textContent).toBe('manifest-hash-unavailable');

    fireEvent.click(screen.getByTestId('manifest-hash-toggle'));
    expect(screen.queryByTestId('manifest-hash-full')).toBeNull();
  });

  it('toggles full hash display after successful fetch', async () => {
    mockFetchWith(new Response(`${VALID_HASH}\n`, { status: 200 }));
    render(<ManifestInfo />);

    await waitFor(() => {
      expect(screen.getByTestId('manifest-hash-short').textContent).toBe(VALID_HASH.slice(0, 16));
    });

    expect(screen.queryByTestId('manifest-hash-full')).toBeNull();

    fireEvent.click(screen.getByTestId('manifest-hash-toggle'));
    expect(screen.getByTestId('manifest-hash-full').textContent).toBe(VALID_HASH);

    fireEvent.click(screen.getByTestId('manifest-hash-toggle'));
    expect(screen.queryByTestId('manifest-hash-full')).toBeNull();
  });

  it('renders the manifest-info-card container', async () => {
    mockFetchWith(new Response(`${VALID_HASH}\n`, { status: 200 }));
    render(<ManifestInfo />);

    expect(screen.getByTestId('manifest-info-card')).toBeTruthy();
  });
});
