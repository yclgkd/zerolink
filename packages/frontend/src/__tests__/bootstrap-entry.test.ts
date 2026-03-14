// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { bootstrapAppMock } = vi.hoisted(() => ({
  bootstrapAppMock: vi.fn(),
}));

vi.mock('../bootstrap', () => ({
  bootstrapApp: bootstrapAppMock,
}));

describe('bootstrap-entry', () => {
  beforeEach(() => {
    vi.resetModules();
    bootstrapAppMock.mockReset();
    document.body.innerHTML = '<div id="root"></div>';
    document.body.style.cssText = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.cssText = '';
  });

  it('renders the blocking release guard when bootstrap startup fails', async () => {
    bootstrapAppMock.mockRejectedValue(new Error('startup failed'));

    await import('../bootstrap-entry');

    await waitFor(() => {
      expect(screen.getByTestId('release-verification-gate')).toBeTruthy();
    });

    expect(screen.getByText('Release Guard')).toBeTruthy();
    expect(screen.getByText('Verification Unavailable')).toBeTruthy();
    expect(
      screen.getByText('ZeroLink could not complete release verification before startup.')
    ).toBeTruthy();
    expect(
      screen.getByText('Do not enter passwords, API keys, or private messages on this page.')
    ).toBeTruthy();
  });
});
