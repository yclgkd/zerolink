// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SECURITY_PROFILE } from '@zerolink/shared';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { detectWebAuthnSupportMock, createChannelMock } = vi.hoisted(() => ({
  detectWebAuthnSupportMock: vi.fn(),
  createChannelMock: vi.fn(),
}));

vi.mock('../crypto/webauthn', async () => {
  const actual = await vi.importActual<typeof import('../crypto/webauthn')>('../crypto/webauthn');
  return {
    ...actual,
    detectWebAuthnSupport: detectWebAuthnSupportMock,
  };
});

vi.mock('../crypto/orchestrator', async () => {
  return {
    cryptoOrchestrator: {
      createChannel: createChannelMock,
    },
  };
});

import { CreatePage } from '../pages/CreatePage';
import { useCreateStore } from '../stores/create-store';

function mockWebAuthnSupport(supported: boolean): void {
  detectWebAuthnSupportMock.mockReturnValue({
    supported,
    secureContext: supported,
    hasPublicKeyCredential: supported,
    hasCredentialsCreate: supported,
    hasCredentialsGet: supported,
  });
}

function mockCreateSuccess(): void {
  createChannelMock.mockResolvedValue({
    ok: true,
    data: {
      shareUrl: '/s/aaaaaaaaaaaaaaaaaaaaa',
      manageUrl: '/m/aaaaaaaaaaaaaaaaaaaaa',
      shareUrlWithFragment: '/s/aaaaaaaaaaaaaaaaaaaaa#k=bW9ja19sb2NrX3NlY3JldA',
      lockSecretB64u: 'bW9ja19sb2NrX3NlY3JldA',
      lockKeyB64u: 'bW9ja19sb2NrX2tleQ',
    },
  });
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function renderCreatePage() {
  return render(
    <MemoryRouter>
      <CreatePage />
    </MemoryRouter>
  );
}

describe('CreatePage integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCreateStore.getState().resetCreateStore();
    mockCreateSuccess();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Quick and Secure mode cards', () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    expect(screen.getByTestId('page-create')).toBeTruthy();
    expect(screen.getByTestId('mode-card-quick')).toBeTruthy();
    expect(screen.getByTestId('mode-card-secure')).toBeTruthy();
  });

  it('defaults to Secure mode when WebAuthn is available', () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    expect(screen.getByTestId('mode-card-secure').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('mode-card-quick').getAttribute('aria-pressed')).toBe('false');
  });

  it('defaults to Quick mode when WebAuthn is unavailable', () => {
    mockWebAuthnSupport(false);
    renderCreatePage();

    expect(screen.getByTestId('mode-card-quick').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('mode-card-secure').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows WebAuthn blocked warning when WebAuthn is unavailable', () => {
    mockWebAuthnSupport(false);
    renderCreatePage();

    const warning = screen.getByTestId('create-webauthn-blocked-warning');
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('role')).toBe('status');
  });

  it('switches to Quick mode when Quick card is clicked', () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    fireEvent.click(screen.getByTestId('mode-card-quick'));
    expect(screen.getByTestId('mode-card-quick').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('mode-card-secure').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows password panel when Quick mode is selected', () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    expect(screen.queryByTestId('quick-share-password-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('mode-card-quick'));
    expect(screen.getByTestId('quick-share-password-panel')).toBeTruthy();
  });

  it('hides password panel when Secure mode is selected', () => {
    mockWebAuthnSupport(false);
    renderCreatePage();

    // Quick is default when no WebAuthn
    expect(screen.getByTestId('quick-share-password-panel')).toBeTruthy();

    // Not clickable when WebAuthn unavailable, but panel should not appear in Secure mode
    // When WebAuthn is available, switching to Secure should hide panel
    mockWebAuthnSupport(true);
    cleanup();
    renderCreatePage();

    // Default is Secure with WebAuthn
    expect(screen.queryByTestId('quick-share-password-panel')).toBeNull();
  });

  it('disables submit button in Quick mode until password is entered', () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    fireEvent.click(screen.getByTestId('mode-card-quick'));

    const submit = screen.getByTestId('create-submit-button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // Button should NOT show spinner/Creating when disabled due to empty form, not submission
    expect(submit.textContent).toContain('Create Channel');
    expect(submit.textContent).not.toContain('Creating');
  });

  it('enables submit button in Quick mode when password is entered', () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    fireEvent.click(screen.getByTestId('mode-card-quick'));

    const input = screen.getByTestId('passphrase-input-field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Strong#Pass123' } });

    const submit = screen.getByTestId('create-submit-button') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it('enables submit button in Secure mode when WebAuthn is available', () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    const submit = screen.getByTestId('create-submit-button') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it('disables submit button in Secure mode when WebAuthn is unavailable', () => {
    mockWebAuthnSupport(false);
    renderCreatePage();

    // Switch to Secure (should not be clickable when unavailable, but test the disabled state)
    const secureCard = screen.getByTestId('mode-card-secure');
    fireEvent.click(secureCard);

    // Secure mode can't be selected when WebAuthn is unavailable - Quick stays selected
    expect(screen.getByTestId('mode-card-quick').getAttribute('aria-pressed')).toBe('true');
  });

  it('calls createChannel with QUICK profile and password', async () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    fireEvent.click(screen.getByTestId('mode-card-quick'));
    const input = screen.getByTestId('passphrase-input-field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Strong#Pass123' } });
    fireEvent.click(screen.getByTestId('create-submit-button'));

    await waitFor(() => {
      expect(createChannelMock).toHaveBeenCalledTimes(1);
    });

    const callArg = createChannelMock.mock.calls[0]?.[0];
    expect(callArg?.profile).toBe(SECURITY_PROFILE.QUICK);
    expect(callArg?.useCompatibilityMode).toBe(true);
    expect(callArg?.softkeyPassphrase).toBe('Strong#Pass123');
    expect(callArg?.uuid).toMatch(/^[A-Za-z0-9_-]{21}$/u);
  });

  it('calls createChannel with SECURE profile when WebAuthn is available', async () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    fireEvent.click(screen.getByTestId('create-submit-button'));

    await waitFor(() => {
      expect(createChannelMock).toHaveBeenCalledTimes(1);
    });

    const callArg = createChannelMock.mock.calls[0]?.[0];
    expect(callArg?.profile).toBe(SECURITY_PROFILE.SECURE);
    expect(callArg?.uuid).toMatch(/^[A-Za-z0-9_-]{21}$/u);
  });

  it('shows share and manage links after successful creation (Secure mode)', async () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    fireEvent.click(screen.getByTestId('create-submit-button'));
    await waitFor(() => {
      expect(screen.getByTestId('create-success-share-link')).toBeTruthy();
      expect(screen.getByTestId('create-success-manage-link')).toBeTruthy();
    });
  });

  it('shows password mode badge in success summary for Quick Share', async () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    fireEvent.click(screen.getByTestId('mode-card-quick'));
    const input = screen.getByTestId('passphrase-input-field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Strong#Pass123' } });
    fireEvent.click(screen.getByTestId('create-submit-button'));

    await waitFor(() => {
      expect(screen.getByTestId('create-password-mode-badge')).toBeTruthy();
    });
  });

  it('shows error notice when createChannel fails', async () => {
    mockWebAuthnSupport(true);
    createChannelMock.mockResolvedValueOnce({
      ok: false,
      error: { ok: false, code: 'NETWORK_ERROR', stage: 'create.begin' },
    });

    renderCreatePage();
    fireEvent.click(screen.getByTestId('create-submit-button'));

    await waitFor(() => {
      expect(screen.getByTestId('create-submit-error')).toBeTruthy();
    });
  });

  it('clears error when mode is switched', async () => {
    mockWebAuthnSupport(true);
    createChannelMock.mockResolvedValueOnce({
      ok: false,
      error: { ok: false, code: 'NETWORK_ERROR', stage: 'create.begin' },
    });

    renderCreatePage();
    fireEvent.click(screen.getByTestId('create-submit-button'));

    await waitFor(() => {
      expect(screen.getByTestId('create-submit-error')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mode-card-quick'));
    expect(screen.queryByTestId('create-submit-error')).toBeNull();
  });

  it('clears password after successful Quick Share creation', async () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    fireEvent.click(screen.getByTestId('mode-card-quick'));
    const input = screen.getByTestId('passphrase-input-field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Strong#Pass123' } });
    fireEvent.click(screen.getByTestId('create-submit-button'));

    await waitFor(() => {
      expect(screen.getByTestId('create-success-summary')).toBeTruthy();
    });

    // Form is hidden after success; click "Create another" to reveal form with cleared password
    fireEvent.click(screen.getByTestId('create-another-button'));
    await waitFor(() => {
      expect(screen.getByTestId('quick-share-password-panel')).toBeTruthy();
    });
    const newInput = screen.getByTestId('passphrase-input-field') as HTMLInputElement;
    expect(newInput.value).toBe('');
  });

  it('disables submit button while create request is pending', async () => {
    mockWebAuthnSupport(true);
    const deferred = createDeferred<{
      ok: true;
      data: {
        shareUrl: string;
        manageUrl: string;
        shareUrlWithFragment: string;
        lockSecretB64u: string;
        lockKeyB64u: string;
      };
    }>();
    createChannelMock.mockReturnValueOnce(deferred.promise);
    renderCreatePage();

    const submit = screen.getByTestId('create-submit-button') as HTMLButtonElement;
    fireEvent.click(submit);

    await waitFor(() => {
      expect((screen.getByTestId('create-submit-button') as HTMLButtonElement).disabled).toBe(true);
    });
    const busyContainer = submit.closest('[aria-busy]');
    expect(busyContainer?.getAttribute('aria-busy')).toBe('true');

    deferred.resolve({
      ok: true,
      data: {
        shareUrl: '/s/aaaaaaaaaaaaaaaaaaaaa',
        manageUrl: '/m/aaaaaaaaaaaaaaaaaaaaa',
        shareUrlWithFragment: '/s/aaaaaaaaaaaaaaaaaaaaa#k=bW9ja19sb2NrX3NlY3JldA',
        lockSecretB64u: 'bW9ja19sb2NrX3NlY3JldA',
        lockKeyB64u: 'bW9ja19sb2NrX2tleQ',
      },
    });

    // After success, form is replaced by success state (submit button is no longer visible)
    await waitFor(() => {
      expect(screen.getByTestId('create-success-summary')).toBeTruthy();
    });
    expect(screen.queryByTestId('create-submit-button')).toBeNull();
  });

  it('renders a trust model link that points to /trust', () => {
    mockWebAuthnSupport(true);
    renderCreatePage();

    const trustLink = screen.getByTestId('create-trust-link');
    expect(trustLink.getAttribute('href')).toBe('/trust');
    expect(trustLink.textContent?.toLowerCase()).toContain('trust model');
  });
});
