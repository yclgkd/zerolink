// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { APP_ROUTES } from '../routes';

function renderFrom(pathname: string) {
  const router = createMemoryRouter(APP_ROUTES, {
    initialEntries: [pathname],
  });

  return { router, ...render(<RouterProvider router={router} />) };
}

describe('App shell routes rendering', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders app shell and default create child route', async () => {
    renderFrom('/');

    expect(await screen.findByTestId('app-shell')).toBeTruthy();
    expect(screen.getByText('Zero')).toBeTruthy();
    expect(screen.queryByTestId('manifest-info-card')).toBeNull();
    expect(screen.getByTestId('page-create')).toBeTruthy();
  });

  it('does not render demo nav links for share/manage', async () => {
    renderFrom('/');

    await screen.findByTestId('app-shell');
    expect(screen.queryByRole('link', { name: 'Share' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Manage' })).toBeNull();
  });

  it('renders trust page inside the app shell and swaps the shell CTA to back-to-create', async () => {
    renderFrom('/trust');

    expect(await screen.findByTestId('app-shell')).toBeTruthy();
    expect(screen.getByTestId('page-trust')).toBeTruthy();
    expect(screen.getByTestId('app-shell-back-link').getAttribute('href')).toBe('/');
    expect(screen.getByTestId('trust-create-button').textContent).toContain(
      'Create Secure Channel'
    );
  });

  it('create-page trust link opens in a new tab without navigating away', async () => {
    renderFrom('/');

    expect(await screen.findByTestId('page-create')).toBeTruthy();

    const trustLink = screen.getByTestId('create-trust-link');
    expect(trustLink.getAttribute('target')).toBe('_blank');
    expect(trustLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(trustLink.getAttribute('href')).toBe('/trust');

    // Create page remains visible (no SPA navigation)
    expect(screen.getByTestId('page-create')).toBeTruthy();
  });

  it('returns to the prior shell route when trust page is opened from the shell trust link', async () => {
    renderFrom('/non-existing-path');

    expect(await screen.findByTestId('page-not-found')).toBeTruthy();

    fireEvent.click(screen.getByTestId('app-shell-trust-link'));
    expect(await screen.findByTestId('page-trust')).toBeTruthy();

    fireEvent.click(screen.getByTestId('trust-back-button'));

    expect(await screen.findByTestId('page-not-found')).toBeTruthy();
  });

  it('falls back to create page when trust page is opened directly', async () => {
    renderFrom('/trust');

    expect(await screen.findByTestId('page-trust')).toBeTruthy();

    fireEvent.click(screen.getByTestId('trust-back-button'));

    expect(await screen.findByTestId('page-create')).toBeTruthy();
  });

  it('falls back to not-found child route for unknown path', async () => {
    renderFrom('/non-existing-path');

    expect(await screen.findByTestId('page-not-found')).toBeTruthy();
    expect(screen.getByText('Page Not Found')).toBeTruthy();
  });
});
