// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CreatePage } from '../pages/CreatePage';

const originalPublicKeyCredential = Object.getOwnPropertyDescriptor(window, 'PublicKeyCredential');
const originalCredentials = Object.getOwnPropertyDescriptor(window.navigator, 'credentials');

function setWebAuthnCapabilities({
  hasPublicKeyCredential,
  hasCredentialsCreate,
}: {
  hasPublicKeyCredential: boolean;
  hasCredentialsCreate: boolean;
}): void {
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    writable: true,
    value: hasPublicKeyCredential ? class MockPublicKeyCredential {} : undefined,
  });

  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    writable: true,
    value: hasCredentialsCreate
      ? {
          create: () => Promise.resolve(null),
        }
      : {},
  });
}

function setWebAuthnSupport(supported: boolean): void {
  setWebAuthnCapabilities({
    hasPublicKeyCredential: supported,
    hasCredentialsCreate: supported,
  });
}

describe('CreatePage', () => {
  afterEach(() => {
    cleanup();

    if (originalPublicKeyCredential) {
      Object.defineProperty(window, 'PublicKeyCredential', originalPublicKeyCredential);
    } else {
      Reflect.deleteProperty(window, 'PublicKeyCredential');
    }

    if (originalCredentials) {
      Object.defineProperty(window.navigator, 'credentials', originalCredentials);
    } else {
      Reflect.deleteProperty(window.navigator, 'credentials');
    }
  });

  it('renders core create UI with three security profile cards', () => {
    setWebAuthnSupport(true);
    render(<CreatePage />);

    expect(screen.getByTestId('page-create')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Create Secure Channel' })).toBeTruthy();
    expect(screen.getByText('Select Security Level')).toBeTruthy();
    expect(screen.getByTestId('security-profile-card-standard')).toBeTruthy();
    expect(screen.getByTestId('security-profile-card-strict')).toBeTruthy();
    expect(screen.getByTestId('security-profile-card-hardware_only')).toBeTruthy();
  });

  it('updates selected profile state when switching cards', () => {
    setWebAuthnSupport(true);
    render(<CreatePage />);

    const standard = screen.getByTestId('security-profile-select-standard');
    const strict = screen.getByTestId('security-profile-select-strict');
    const hardwareOnly = screen.getByTestId('security-profile-select-hardware_only');

    expect(standard.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(strict);
    expect(strict.getAttribute('aria-pressed')).toBe('true');
    expect(standard.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(hardwareOnly);
    expect(hardwareOnly.getAttribute('aria-pressed')).toBe('true');
    expect(strict.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows blocking warning for strict and hardware_only when WebAuthn is unavailable', () => {
    setWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('security-profile-select-strict'));
    expect(
      screen.getByText('Strict and Hardware-Only profiles require WebAuthn support.')
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('security-profile-select-hardware_only'));
    expect(
      screen.getByText('Strict and Hardware-Only profiles require WebAuthn support.')
    ).toBeTruthy();
  });

  it('treats constructor-only WebAuthn environment as unsupported', () => {
    setWebAuthnCapabilities({
      hasPublicKeyCredential: true,
      hasCredentialsCreate: false,
    });
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('security-profile-select-strict'));
    expect(
      screen.getByText('Strict and Hardware-Only profiles require WebAuthn support.')
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('security-profile-select-standard'));
    fireEvent.click(screen.getByTestId('create-submit-button'));
    expect(screen.getByTestId('create-compatibility-panel')).toBeTruthy();
  });

  it('shows compatibility panel for standard profile when WebAuthn is unavailable', () => {
    setWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));

    expect(screen.getByTestId('create-compatibility-panel')).toBeTruthy();
    expect(screen.queryByTestId('create-success-summary')).toBeNull();
  });

  it('keeps compatibility continue disabled until risk acceptance is checked', () => {
    setWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    const continueButton = screen.getByTestId('create-compatibility-continue') as HTMLButtonElement;

    expect(continueButton.disabled).toBe(true);
  });

  it('continues with compatibility mode after acceptance and shows success summary', () => {
    setWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    fireEvent.click(screen.getByTestId('create-compatibility-checkbox'));
    fireEvent.click(screen.getByTestId('create-compatibility-continue'));

    expect(screen.getByTestId('create-success-summary')).toBeTruthy();
    expect(screen.queryByTestId('create-compatibility-panel')).toBeNull();
  });

  it('requires a new compatibility acceptance for each create attempt', () => {
    setWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    fireEvent.click(screen.getByTestId('create-compatibility-checkbox'));
    fireEvent.click(screen.getByTestId('create-compatibility-continue'));

    fireEvent.click(screen.getByTestId('create-submit-button'));

    const continueButton = screen.getByTestId('create-compatibility-continue') as HTMLButtonElement;
    const checkbox = screen.getByTestId('create-compatibility-checkbox') as HTMLInputElement;

    expect(checkbox.checked).toBe(false);
    expect(continueButton.disabled).toBe(true);
  });

  it('cancels compatibility panel without creating a channel', () => {
    setWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    fireEvent.click(screen.getByTestId('create-compatibility-cancel'));

    expect(screen.queryByTestId('create-compatibility-panel')).toBeNull();
    expect(screen.queryByTestId('create-success-summary')).toBeNull();
  });

  it('does not render passphrase input inside compatibility panel', () => {
    setWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));

    expect(screen.queryByTestId('passphrase-input-root')).toBeNull();
    expect(screen.queryByTestId('passphrase-input-field')).toBeNull();
  });
});
