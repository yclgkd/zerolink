// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { APP_ROUTES } from '../routes';

function renderFrom(pathname: string) {
  const router = createMemoryRouter(APP_ROUTES, {
    initialEntries: [pathname],
  });

  return render(<RouterProvider router={router} />);
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

  it('renders trust page inside the app shell and shows the shell trust link', async () => {
    renderFrom('/trust');

    expect(await screen.findByTestId('app-shell')).toBeTruthy();
    expect(screen.getByTestId('page-trust')).toBeTruthy();
    expect(screen.getByTestId('app-shell-trust-link').getAttribute('href')).toBe('/trust');
  });

  it('falls back to not-found child route for unknown path', async () => {
    renderFrom('/non-existing-path');

    expect(await screen.findByTestId('page-not-found')).toBeTruthy();
    expect(screen.getByText('Page Not Found')).toBeTruthy();
  });
});
