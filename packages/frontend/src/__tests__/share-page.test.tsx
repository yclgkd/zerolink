// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { SharePage } from '../pages/SharePage';

function renderSharePage(routePath = '/s/:uuid', initialPath = '/s/demo-channel-shell') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<SharePage />} path={routePath} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SharePage', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders onboarding state by default', () => {
    renderSharePage();

    expect(screen.getByTestId('page-share')).toBeTruthy();
    expect(screen.getByTestId('share-step-onboarding')).toBeTruthy();
    expect(screen.getByText('Your passphrase stays on this device')).toBeTruthy();
  });

  it('moves from onboarding to lock form when continuing', () => {
    renderSharePage();

    fireEvent.click(screen.getByTestId('share-continue-button'));
    expect(screen.getByTestId('share-step-lock')).toBeTruthy();
  });

  it('renders passphrase input and lock actions in lock form state', () => {
    renderSharePage();

    fireEvent.click(screen.getByTestId('share-continue-button'));
    expect(screen.getByTestId('passphrase-input-field')).toBeTruthy();
    expect(screen.getByTestId('share-back-button')).toBeTruthy();
    expect(screen.getByTestId('share-generate-button')).toBeTruthy();
  });

  it('keeps generate button disabled when passphrase is empty', () => {
    renderSharePage();

    fireEvent.click(screen.getByTestId('share-continue-button'));
    const generateButton = screen.getByTestId('share-generate-button') as HTMLButtonElement;

    expect(generateButton.disabled).toBe(true);
  });

  it('transitions to locked state after entering passphrase and clicking generate', () => {
    renderSharePage();

    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    fireEvent.click(screen.getByTestId('share-generate-button'));

    expect(screen.getByTestId('share-step-locked')).toBeTruthy();
    expect(screen.getByText('Safety Code')).toBeTruthy();
  });

  it('renders next steps content in locked state', () => {
    renderSharePage();

    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Strong#Pass1234XYZ' },
    });
    fireEvent.click(screen.getByTestId('share-generate-button'));

    expect(screen.getByTestId('share-next-steps')).toBeTruthy();
    expect(screen.getByText('Contact the sender through another channel.')).toBeTruthy();
  });

  it('returns to onboarding when clicking back from lock form', () => {
    renderSharePage();

    fireEvent.click(screen.getByTestId('share-continue-button'));
    fireEvent.click(screen.getByTestId('share-back-button'));

    expect(screen.getByTestId('share-step-onboarding')).toBeTruthy();
    expect(screen.queryByTestId('share-step-lock')).toBeNull();
  });

  it('shows uuid and receiver role badge', () => {
    renderSharePage();

    expect(screen.getByTestId('share-uuid').textContent).toContain('demo-channel-shell');
    expect(screen.getByText('Receiver')).toBeTruthy();
  });

  it('falls back to missing uuid label when uuid param is absent', () => {
    renderSharePage('/s', '/s');

    expect(screen.getByTestId('share-uuid').textContent).toContain('(missing uuid)');
  });
});
