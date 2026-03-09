// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { TrustPage } from '../pages/TrustPage';

describe('TrustPage', () => {
  it('renders the four trust sections and key facts', () => {
    render(
      <MemoryRouter>
        <TrustPage />
      </MemoryRouter>
    );

    const page = screen.getByTestId('page-trust');
    const pageText = page.textContent ?? '';

    expect(page).toBeTruthy();
    expect(screen.getByText('What the server cannot see')).toBeTruthy();
    expect(screen.getByText('What the sender can and cannot do')).toBeTruthy();
    expect(screen.getByText('What is stored on the receiver device')).toBeTruthy();
    expect(screen.getByText('When data becomes unavailable')).toBeTruthy();

    expect(pageText).toContain('URL fragment (#k=...)');
    expect(pageText).toContain('receiver passphrase');
    expect(pageText).toContain('receiver private key');
    expect(pageText).toContain('decrypted plaintext');
    expect(pageText).toContain('IndexedDB');
    expect(pageText).toContain('1 hour after creation');
    expect(pageText).toContain('Local burn removes plaintext only on this device');
    expect(pageText).toContain('does not delete or expire the channel');
  });
});
