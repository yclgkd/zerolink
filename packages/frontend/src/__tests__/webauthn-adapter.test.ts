// @vitest-environment jsdom

import { SECURITY_PROFILE } from '@zerolink/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@github/webauthn-json', () => ({
  supported: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
}));

import {
  create as webauthnCreate,
  get as webauthnGet,
  supported as webauthnSupported,
} from '@github/webauthn-json';

import {
  assertWithWebAuthn,
  detectWebAuthnSupport,
  evaluateWebAuthnMode,
  registerWithWebAuthn,
  resolveWebAuthnPolicy,
} from '../crypto/webauthn';

const VALID_B64U = 'bW9ja19iYXNlNjR1cmw';
const ORIGINAL_SECURE_CONTEXT_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  window,
  'isSecureContext'
);
const ORIGINAL_PUBLIC_KEY_CREDENTIAL_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  window,
  'PublicKeyCredential'
);
const ORIGINAL_CREDENTIALS_DESCRIPTOR = Object.getOwnPropertyDescriptor(navigator, 'credentials');

type WebAuthnEnvironmentOptions = {
  secureContext?: boolean;
  hasPublicKeyCredential?: boolean;
  hasCredentialsCreate?: boolean;
  hasCredentialsGet?: boolean;
};

function restoreDescriptor<T extends object>(
  target: T,
  key: keyof T,
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  Reflect.deleteProperty(target, key);
}

function setWebAuthnEnvironment({
  secureContext = true,
  hasPublicKeyCredential = true,
  hasCredentialsCreate = true,
  hasCredentialsGet = true,
}: WebAuthnEnvironmentOptions = {}) {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: secureContext,
  });

  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: hasPublicKeyCredential ? class PublicKeyCredentialMock {} : undefined,
  });

  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {
      ...(hasCredentialsCreate
        ? { create: vi.fn(async () => ({ id: 'mock-create' })) }
        : { create: undefined }),
      ...(hasCredentialsGet
        ? { get: vi.fn(async () => ({ id: 'mock-get' })) }
        : { get: undefined }),
    },
  });
}

const VALID_CREATION_PUBLIC_KEY = {
  challenge: VALID_B64U,
  rp: {
    name: 'ZeroLink',
  },
  user: {
    id: VALID_B64U,
    name: 'alice@example.com',
    displayName: 'Alice',
  },
  pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
};

const VALID_REQUEST_PUBLIC_KEY = {
  challenge: VALID_B64U,
  allowCredentials: [{ type: 'public-key' as const, id: VALID_B64U }],
};

beforeEach(() => {
  vi.clearAllMocks();
  setWebAuthnEnvironment();
  vi.mocked(webauthnSupported).mockReturnValue(true);
});

afterEach(() => {
  restoreDescriptor(window, 'isSecureContext', ORIGINAL_SECURE_CONTEXT_DESCRIPTOR);
  restoreDescriptor(window, 'PublicKeyCredential', ORIGINAL_PUBLIC_KEY_CREDENTIAL_DESCRIPTOR);
  restoreDescriptor(navigator, 'credentials', ORIGINAL_CREDENTIALS_DESCRIPTOR);
});

describe('detectWebAuthnSupport', () => {
  it('returns full support when secure context and webauthn capabilities exist', () => {
    setWebAuthnEnvironment({
      secureContext: true,
      hasPublicKeyCredential: true,
      hasCredentialsCreate: true,
      hasCredentialsGet: true,
    });
    vi.mocked(webauthnSupported).mockReturnValue(true);

    expect(detectWebAuthnSupport()).toEqual({
      supported: true,
      secureContext: true,
      hasPublicKeyCredential: true,
      hasCredentialsCreate: true,
      hasCredentialsGet: true,
    });
  });

  it('returns unsupported when secure context is false or required capability is missing', () => {
    setWebAuthnEnvironment({
      secureContext: false,
      hasPublicKeyCredential: true,
      hasCredentialsCreate: true,
      hasCredentialsGet: true,
    });
    vi.mocked(webauthnSupported).mockReturnValue(true);

    expect(detectWebAuthnSupport().supported).toBe(false);

    setWebAuthnEnvironment({
      secureContext: true,
      hasPublicKeyCredential: true,
      hasCredentialsCreate: false,
      hasCredentialsGet: true,
    });
    vi.mocked(webauthnSupported).mockReturnValue(true);

    const missingCreate = detectWebAuthnSupport();
    expect(missingCreate.supported).toBe(false);
    expect(missingCreate.hasCredentialsCreate).toBe(false);
  });
});

describe('resolveWebAuthnPolicy', () => {
  it('returns standard profile defaults', () => {
    expect(resolveWebAuthnPolicy(SECURITY_PROFILE.STANDARD)).toEqual({
      userVerification: 'preferred',
      residentKey: 'preferred',
      attestation: 'none',
    });
  });

  it('returns strict profile defaults', () => {
    expect(resolveWebAuthnPolicy(SECURITY_PROFILE.STRICT)).toEqual({
      userVerification: 'required',
      residentKey: 'required',
      attestation: 'none',
    });
  });

  it('returns hardware-only profile defaults', () => {
    expect(resolveWebAuthnPolicy(SECURITY_PROFILE.HARDWARE_ONLY)).toEqual({
      userVerification: 'required',
      residentKey: 'preferred',
      attestation: 'direct',
      authenticatorAttachment: 'cross-platform',
      hints: ['security-key'],
    });
  });
});

describe('evaluateWebAuthnMode', () => {
  it('returns fallback for unsupported standard profile', () => {
    expect(
      evaluateWebAuthnMode(SECURITY_PROFILE.STANDARD, {
        supported: false,
        secureContext: false,
        hasPublicKeyCredential: false,
        hasCredentialsCreate: false,
        hasCredentialsGet: false,
      })
    ).toEqual({
      mode: 'fallback',
      allowed: false,
      reason: 'WEBAUTHN_UNAVAILABLE',
    });
  });

  it('returns blocked for unsupported strict and hardware profiles', () => {
    const support = {
      supported: false,
      secureContext: false,
      hasPublicKeyCredential: false,
      hasCredentialsCreate: false,
      hasCredentialsGet: false,
    } as const;

    expect(evaluateWebAuthnMode(SECURITY_PROFILE.STRICT, support)).toEqual({
      mode: 'blocked',
      allowed: false,
      reason: 'PROFILE_REQUIRES_WEBAUTHN',
    });
    expect(evaluateWebAuthnMode(SECURITY_PROFILE.HARDWARE_ONLY, support)).toEqual({
      mode: 'blocked',
      allowed: false,
      reason: 'PROFILE_REQUIRES_WEBAUTHN',
    });
  });
});

describe('registerWithWebAuthn', () => {
  it('returns shared attestation shape and strips non-required fields', async () => {
    vi.mocked(webauthnCreate).mockResolvedValue({
      id: VALID_B64U,
      rawId: VALID_B64U,
      type: 'public-key',
      response: {
        clientDataJSON: VALID_B64U,
        attestationObject: VALID_B64U,
        transports: ['internal'],
        extra: 'remove-me',
      },
      clientExtensionResults: {},
      extraTopLevel: 'remove-me',
    } as never);

    const result = await registerWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      creationOptions: {
        publicKey: VALID_CREATION_PUBLIC_KEY,
      },
    });

    expect(result).toEqual({
      ok: true,
      data: {
        id: VALID_B64U,
        rawId: VALID_B64U,
        type: 'public-key',
        response: {
          clientDataJSON: VALID_B64U,
          attestationObject: VALID_B64U,
          transports: ['internal'],
        },
      },
    });
  });

  it('applies profile policy fields to creation options', async () => {
    vi.mocked(webauthnCreate).mockResolvedValue({
      id: VALID_B64U,
      rawId: VALID_B64U,
      type: 'public-key',
      response: {
        clientDataJSON: VALID_B64U,
        attestationObject: VALID_B64U,
        transports: ['usb'],
      },
      clientExtensionResults: {},
    } as never);

    await registerWithWebAuthn({
      profile: SECURITY_PROFILE.HARDWARE_ONLY,
      creationOptions: {
        publicKey: {
          ...VALID_CREATION_PUBLIC_KEY,
          attestation: 'none',
          authenticatorSelection: {
            userVerification: 'preferred',
            residentKey: 'discouraged',
          },
        },
      },
    });

    const createCall = vi.mocked(webauthnCreate).mock.calls[0]?.[0];
    expect(createCall).toMatchObject({
      publicKey: {
        attestation: 'direct',
        hints: ['security-key'],
        authenticatorSelection: {
          userVerification: 'required',
          residentKey: 'preferred',
          authenticatorAttachment: 'cross-platform',
        },
      },
    });
  });

  it('accepts raw publicKey creation options and normalizes to wrapped options', async () => {
    vi.mocked(webauthnCreate).mockResolvedValue({
      id: VALID_B64U,
      rawId: VALID_B64U,
      type: 'public-key',
      response: {
        clientDataJSON: VALID_B64U,
        attestationObject: VALID_B64U,
        transports: ['internal'],
      },
      clientExtensionResults: {},
    } as never);

    const result = await registerWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      creationOptions: VALID_CREATION_PUBLIC_KEY,
    });

    expect(result.ok).toBe(true);
    expect(vi.mocked(webauthnCreate).mock.calls[0]?.[0]).toMatchObject({
      publicKey: VALID_CREATION_PUBLIC_KEY,
    });
  });

  it('returns INVALID_OPTIONS without calling webauthn create for invalid options', async () => {
    const result = await registerWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      creationOptions: {} as never,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'INVALID_OPTIONS',
      },
    });
    expect(vi.mocked(webauthnCreate)).not.toHaveBeenCalled();
  });

  it('returns FALLBACK_REQUIRED for unsupported standard profile without calling create', async () => {
    setWebAuthnEnvironment({ secureContext: false });
    vi.mocked(webauthnSupported).mockReturnValue(false);

    const result = await registerWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      creationOptions: {
        publicKey: VALID_CREATION_PUBLIC_KEY,
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'FALLBACK_REQUIRED',
      },
    });
    expect(vi.mocked(webauthnCreate)).not.toHaveBeenCalled();
  });

  it('returns PROFILE_BLOCKED for unsupported strict/hardware profiles without calling create', async () => {
    setWebAuthnEnvironment({ secureContext: false });
    vi.mocked(webauthnSupported).mockReturnValue(false);

    const strictResult = await registerWithWebAuthn({
      profile: SECURITY_PROFILE.STRICT,
      creationOptions: { publicKey: VALID_CREATION_PUBLIC_KEY },
    });
    const hardwareResult = await registerWithWebAuthn({
      profile: SECURITY_PROFILE.HARDWARE_ONLY,
      creationOptions: { publicKey: VALID_CREATION_PUBLIC_KEY },
    });

    expect(strictResult).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'PROFILE_BLOCKED',
      },
    });
    expect(hardwareResult).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'PROFILE_BLOCKED',
      },
    });
    expect(vi.mocked(webauthnCreate)).not.toHaveBeenCalled();
  });

  it('maps NotAllowedError to NOT_ALLOWED', async () => {
    vi.mocked(webauthnCreate).mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));

    const result = await registerWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      creationOptions: { publicKey: VALID_CREATION_PUBLIC_KEY },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        ok: false,
        code: 'NOT_ALLOWED',
        causeName: 'NotAllowedError',
      },
    });
  });
});

describe('assertWithWebAuthn', () => {
  it('returns shared assertion shape', async () => {
    vi.mocked(webauthnGet).mockResolvedValue({
      id: VALID_B64U,
      rawId: VALID_B64U,
      type: 'public-key',
      response: {
        clientDataJSON: VALID_B64U,
        authenticatorData: VALID_B64U,
        signature: VALID_B64U,
        userHandle: null,
        extra: 'remove-me',
      },
      clientExtensionResults: {},
    } as never);

    const result = await assertWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      requestOptions: {
        publicKey: VALID_REQUEST_PUBLIC_KEY,
      },
    });

    expect(result).toEqual({
      ok: true,
      data: {
        id: VALID_B64U,
        rawId: VALID_B64U,
        type: 'public-key',
        response: {
          clientDataJSON: VALID_B64U,
          authenticatorData: VALID_B64U,
          signature: VALID_B64U,
          userHandle: null,
        },
      },
    });
  });

  it('applies profile user verification policy to request options', async () => {
    vi.mocked(webauthnGet).mockResolvedValue({
      id: VALID_B64U,
      rawId: VALID_B64U,
      type: 'public-key',
      response: {
        clientDataJSON: VALID_B64U,
        authenticatorData: VALID_B64U,
        signature: VALID_B64U,
        userHandle: null,
      },
      clientExtensionResults: {},
    } as never);

    await assertWithWebAuthn({
      profile: SECURITY_PROFILE.STRICT,
      requestOptions: {
        publicKey: {
          ...VALID_REQUEST_PUBLIC_KEY,
          userVerification: 'preferred',
        },
      },
    });

    const getCall = vi.mocked(webauthnGet).mock.calls[0]?.[0];
    expect(getCall).toMatchObject({
      publicKey: {
        userVerification: 'required',
      },
    });
  });

  it('accepts raw publicKey request options and normalizes to wrapped options', async () => {
    vi.mocked(webauthnGet).mockResolvedValue({
      id: VALID_B64U,
      rawId: VALID_B64U,
      type: 'public-key',
      response: {
        clientDataJSON: VALID_B64U,
        authenticatorData: VALID_B64U,
        signature: VALID_B64U,
        userHandle: null,
      },
      clientExtensionResults: {},
    } as never);

    const result = await assertWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      requestOptions: VALID_REQUEST_PUBLIC_KEY,
    });

    expect(result.ok).toBe(true);
    expect(vi.mocked(webauthnGet).mock.calls[0]?.[0]).toMatchObject({
      publicKey: VALID_REQUEST_PUBLIC_KEY,
    });
  });

  it('returns INVALID_OPTIONS without calling webauthn get for invalid options', async () => {
    const result = await assertWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      requestOptions: {} as never,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'INVALID_OPTIONS',
      },
    });
    expect(vi.mocked(webauthnGet)).not.toHaveBeenCalled();
  });

  it('returns FALLBACK_REQUIRED for unsupported standard profile without calling get', async () => {
    setWebAuthnEnvironment({ secureContext: false });
    vi.mocked(webauthnSupported).mockReturnValue(false);

    const result = await assertWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      requestOptions: { publicKey: VALID_REQUEST_PUBLIC_KEY },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'FALLBACK_REQUIRED',
      },
    });
    expect(vi.mocked(webauthnGet)).not.toHaveBeenCalled();
  });

  it('returns PROFILE_BLOCKED for unsupported strict/hardware profiles without calling get', async () => {
    setWebAuthnEnvironment({ secureContext: false });
    vi.mocked(webauthnSupported).mockReturnValue(false);

    const strictResult = await assertWithWebAuthn({
      profile: SECURITY_PROFILE.STRICT,
      requestOptions: { publicKey: VALID_REQUEST_PUBLIC_KEY },
    });
    const hardwareResult = await assertWithWebAuthn({
      profile: SECURITY_PROFILE.HARDWARE_ONLY,
      requestOptions: { publicKey: VALID_REQUEST_PUBLIC_KEY },
    });

    expect(strictResult).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'PROFILE_BLOCKED',
      },
    });
    expect(hardwareResult).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'PROFILE_BLOCKED',
      },
    });
    expect(vi.mocked(webauthnGet)).not.toHaveBeenCalled();
  });

  it('maps AbortError to ABORTED', async () => {
    vi.mocked(webauthnGet).mockRejectedValue(new DOMException('Cancelled', 'AbortError'));

    const result = await assertWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      requestOptions: { publicKey: VALID_REQUEST_PUBLIC_KEY },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        ok: false,
        code: 'ABORTED',
        causeName: 'AbortError',
      },
    });
  });

  it('maps unknown thrown error to WEBAUTHN_ERROR', async () => {
    vi.mocked(webauthnGet).mockRejectedValue(new Error('Unexpected failure'));

    const result = await assertWithWebAuthn({
      profile: SECURITY_PROFILE.STANDARD,
      requestOptions: { publicKey: VALID_REQUEST_PUBLIC_KEY },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'WEBAUTHN_ERROR',
        message: 'Unexpected failure',
        causeName: 'Error',
      },
    });
  });
});
