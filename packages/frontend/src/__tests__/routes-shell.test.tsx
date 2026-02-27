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
    expect(screen.getByTestId('page-create')).toBeTruthy();
    expect(screen.getByTestId('current-path').textContent).toBe('/');
  });

  it('renders navigation links for create/share/manage demo entries', async () => {
    renderFrom('/');

    const createLink = await screen.findByRole('link', { name: 'Create' });
    const shareLink = screen.getByRole('link', { name: 'Share' });
    const manageLink = screen.getByRole('link', { name: 'Manage' });

    expect(createLink.getAttribute('href')).toBe('/');
    expect(shareLink.getAttribute('href')).toBe('/s/demo-channel-shell');
    expect(manageLink.getAttribute('href')).toBe('/m/demo-channel-shell');
  });

  it('falls back to not-found child route for unknown path', async () => {
    renderFrom('/non-existing-path');

    expect(await screen.findByTestId('page-not-found')).toBeTruthy();
    expect(screen.getByText('Page Not Found')).toBeTruthy();
    expect(screen.getByTestId('current-path').textContent).toBe('/non-existing-path');
  });
});
