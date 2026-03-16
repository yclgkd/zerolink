// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { TrustPage } from '../pages/TrustPage';

describe('TrustPage', () => {
  it('renders the six trust sections, key facts, and footer actions', () => {
    render(
      <MemoryRouter>
        <TrustPage />
      </MemoryRouter>
    );

    const page = screen.getByTestId('page-trust');
    const pageText = page.textContent ?? '';

    expect(page).toBeTruthy();
    expect(screen.getByText('What the server never gets')).toBeTruthy();
    expect(screen.getByText('What the server stores at each stage')).toBeTruthy();
    expect(screen.getByText('What the sender can control')).toBeTruthy();
    expect(screen.getByText('What stays on the sender device')).toBeTruthy();
    expect(screen.getByText('What stays on the receiver device')).toBeTruthy();
    expect(screen.getByText('Delete, expiry, local burn, and Verified Release')).toBeTruthy();

    expect(pageText).toContain('URL fragment (#k=...)');
    expect(pageText).toContain('receiver passphrase');
    expect(pageText).toContain('receiver private key');
    expect(pageText).toContain('decrypted plaintext');
    expect(pageText).toContain('At create time');
    expect(pageText).toContain('admin auth material');
    expect(pageText).toContain('receiver public key and fingerprint');
    expect(pageText).toContain('ciphertext for the receiver to fetch');
    expect(pageText).toContain('wrapped admin key');
    expect(pageText).toContain('IndexedDB');
    expect(pageText).toContain('expire after 1 hour');
    expect(pageText).toContain('tombstone');
    expect(pageText).toContain('Local burn removes plaintext from this device only');
    expect(pageText).toContain('Verified Release means the build passed');
    expect(screen.getByTestId('trust-back-button')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create Secure Channel' }).getAttribute('href')).toBe(
      '/'
    );
  });
});
