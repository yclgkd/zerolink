// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SECURITY_PROFILE, type SecurityProfile } from '@zerolink/shared';
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

function expectProfileSelected(profile: SecurityProfile): void {
  const allProfiles: SecurityProfile[] = [
    SECURITY_PROFILE.STANDARD,
    SECURITY_PROFILE.STRICT,
    SECURITY_PROFILE.HARDWARE_ONLY,
  ];
  for (const item of allProfiles) {
    const button = screen.getByTestId(`security-profile-select-${item}`);
    expect(button.getAttribute('aria-pressed')).toBe(item === profile ? 'true' : 'false');
  }
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
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

  it('renders three security profile cards by default', () => {
    mockWebAuthnSupport(true);
    render(<CreatePage />);

    expect(screen.getByTestId('page-create')).toBeTruthy();
    expect(screen.getByTestId('security-profile-card-standard')).toBeTruthy();
    expect(screen.getByTestId('security-profile-card-strict')).toBeTruthy();
    expect(screen.getByTestId('security-profile-card-hardware_only')).toBeTruthy();
  });

  it('updates selected state when switching profile cards', () => {
    mockWebAuthnSupport(true);
    render(<CreatePage />);

    expectProfileSelected(SECURITY_PROFILE.STANDARD);
    fireEvent.click(screen.getByTestId('security-profile-select-strict'));
    expectProfileSelected(SECURITY_PROFILE.STRICT);
    fireEvent.click(screen.getByTestId('security-profile-select-hardware_only'));
    expectProfileSelected(SECURITY_PROFILE.HARDWARE_ONLY);
  });

  it('shows blocking warning and blocks create for strict/hardware when WebAuthn is unavailable', async () => {
    mockWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('security-profile-select-strict'));
    fireEvent.click(screen.getByTestId('create-submit-button'));
    const warning = screen.getByTestId('create-webauthn-blocked-warning');
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('aria-live')).toBe('polite');

    fireEvent.click(screen.getByTestId('security-profile-select-hardware_only'));
    fireEvent.click(screen.getByTestId('create-submit-button'));
    expect(screen.getByTestId('create-webauthn-blocked-warning')).toBeTruthy();

    await waitFor(() => {
      expect(createChannelMock).not.toHaveBeenCalled();
    });
  });

  it('opens compatibility panel on first standard create click when WebAuthn is unavailable', async () => {
    mockWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    expect(screen.getByTestId('create-compatibility-panel')).toBeTruthy();
    await waitFor(() => {
      expect(createChannelMock).not.toHaveBeenCalled();
    });
  });

  it('keeps compatibility continue disabled until checkbox and passphrase are provided', () => {
    mockWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    const continueButton = screen.getByTestId('create-compatibility-continue') as HTMLButtonElement;
    const passphraseInput = screen.getByTestId('passphrase-input-field') as HTMLInputElement;

    expect(continueButton.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('create-compatibility-checkbox'));
    expect(continueButton.disabled).toBe(true);

    fireEvent.change(passphraseInput, { target: { value: 'Compat#Pass123' } });
    expect(continueButton.disabled).toBe(false);
  });

  it('calls createChannel with useCompatibilityMode via compatibility continue', async () => {
    mockWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Compat#Pass123' },
    });
    fireEvent.click(screen.getByTestId('create-compatibility-checkbox'));
    fireEvent.click(screen.getByTestId('create-compatibility-continue'));

    await waitFor(() => {
      expect(createChannelMock).toHaveBeenCalledTimes(1);
    });

    const callArg = createChannelMock.mock.calls[0]?.[0];
    expect(callArg?.profile).toBe(SECURITY_PROFILE.STANDARD);
    expect(callArg?.useCompatibilityMode).toBe(true);
    expect(callArg?.softkeyPassphrase).toBe('Compat#Pass123');
  });

  it('calls createChannel with useCompatibilityMode via primary create button', async () => {
    mockWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'Compat#Pass123' },
    });
    fireEvent.click(screen.getByTestId('create-compatibility-checkbox'));
    fireEvent.click(screen.getByTestId('create-submit-button'));

    await waitFor(() => {
      expect(createChannelMock).toHaveBeenCalledTimes(1);
    });

    const callArg = createChannelMock.mock.calls[0]?.[0];
    expect(callArg?.profile).toBe(SECURITY_PROFILE.STANDARD);
    expect(callArg?.useCompatibilityMode).toBe(true);
    expect(callArg?.softkeyPassphrase).toBe('Compat#Pass123');
  });

  it('calls createChannel with selected profile and valid uuid when supported', async () => {
    mockWebAuthnSupport(true);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('security-profile-select-strict'));
    fireEvent.click(screen.getByTestId('create-submit-button'));

    await waitFor(() => {
      expect(createChannelMock).toHaveBeenCalledTimes(1);
    });

    const callArg = createChannelMock.mock.calls[0]?.[0];
    expect(callArg?.profile).toBe(SECURITY_PROFILE.STRICT);
    expect(callArg?.uuid).toMatch(/^[A-Za-z0-9_-]{21}$/u);
  });

  it('shows share and manage links after successful creation', async () => {
    mockWebAuthnSupport(true);
    mockCreateSuccess();
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    await waitFor(() => {
      expect(screen.getByTestId('create-success-share-link')).toBeTruthy();
      expect(screen.getByTestId('create-success-manage-link')).toBeTruthy();
    });
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
    render(<CreatePage />);

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

    await waitFor(() => {
      expect((screen.getByTestId('create-submit-button') as HTMLButtonElement).disabled).toBe(
        false
      );
    });
    expect(busyContainer?.getAttribute('aria-busy')).toBe('false');
  });

  it('cancels compatibility panel and resets acceptance checkbox', () => {
    mockWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    fireEvent.click(screen.getByTestId('create-compatibility-checkbox'));
    fireEvent.click(screen.getByTestId('create-compatibility-cancel'));

    expect(screen.queryByTestId('create-compatibility-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('create-submit-button'));
    const continueButton = screen.getByTestId('create-compatibility-continue') as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
  });

  it('shows passphrase input inside compatibility panel', () => {
    mockWebAuthnSupport(false);
    render(<CreatePage />);

    fireEvent.click(screen.getByTestId('create-submit-button'));
    expect(screen.getByTestId('passphrase-input-root')).toBeTruthy();
    expect(screen.getByTestId('passphrase-input-field')).toBeTruthy();
  });
});
