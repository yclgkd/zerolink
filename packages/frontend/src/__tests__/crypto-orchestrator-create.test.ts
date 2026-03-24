// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import {
  type AttestationJSON,
  type CreateBeginResponse,
  computeSenderAuthFingerprintFromAttestation,
  SECURITY_PROFILE,
} from '@zerolink/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../crypto/webauthn', async () => {
  const actual = await vi.importActual<typeof import('../crypto/webauthn')>('../crypto/webauthn');
  return {
    ...actual,
    registerWithWebAuthn: vi.fn(),
    assertWithWebAuthn: vi.fn(),
  };
});

import { registerWithWebAuthn, type WebAuthnAdapterResult } from '../crypto/webauthn';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import {
  createOrchestrator,
  extractSenderAuthFprFromShareUrl,
  VALID_ATTESTATION,
  VALID_B64U,
  VALID_SENDER_AUTH_FPR,
  VALID_UUID,
  VALID_UUID_BRANDED,
} from './helpers/orchestrator-fixtures';

beforeEach(() => {
  vi.clearAllMocks();
  useCreateStore.getState().resetCreateStore();
  useLockStore.getState().resetLockStore();
  useDeliverStore.getState().resetDeliverStore();
  useDecryptStore.getState().resetDecryptStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crypto orchestrator – createChannel', () => {
  it('runs create channel flow and updates create store', async () => {
    const { orchestrator, apiClient } = createOrchestrator();

    const creationOptions: CreateBeginResponse['creationOptions'] = {
      publicKey: {
        challenge: VALID_B64U,
        rp: { name: 'ZeroLink' },
        user: {
          id: VALID_B64U,
          name: 'alice@example.com',
          displayName: 'Alice',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      },
    };

    vi.mocked(apiClient.createBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        creationOptions,
      },
    });
    vi.mocked(registerWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ATTESTATION,
    } satisfies WebAuthnAdapterResult<AttestationJSON>);
    vi.mocked(apiClient.createFinish).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        shareUrl: '/s/aaaaaaaaaaaaaaaaaaaaa',
        manageUrl: '/m/aaaaaaaaaaaaaaaaaaaaa',
      },
    });

    const result = await orchestrator.createChannel({
      uuid: VALID_UUID_BRANDED,
      profile: SECURITY_PROFILE.SECURE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const senderAuthFpr = extractSenderAuthFprFromShareUrl(result.data.shareUrlWithFragment);
    expect(result.data.shareUrlWithFragment).toContain('#k=');
    expect(result.data.shareUrlWithFragment).toContain('&af=');
    await expect(computeSenderAuthFingerprintFromAttestation(VALID_ATTESTATION)).resolves.toBe(
      VALID_SENDER_AUTH_FPR
    );
    expect(senderAuthFpr).toBe(VALID_SENDER_AUTH_FPR);
    expect(result.data.lockKeyB64u).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(vi.mocked(apiClient.createBegin)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiClient.createFinish)).toHaveBeenCalledTimes(1);
    expect(useCreateStore.getState().createBegin.status).toBe('success');
    expect(useCreateStore.getState().createFinish.status).toBe('success');
    expect(useCreateStore.getState().createdProfile).toBe(SECURITY_PROFILE.SECURE);
  });

  it('fails create channel when webauthn adapter returns FALLBACK_REQUIRED', async () => {
    const { orchestrator, apiClient } = createOrchestrator();

    vi.mocked(apiClient.createBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        creationOptions: {
          publicKey: {
            challenge: VALID_B64U,
            rp: { name: 'ZeroLink' },
            user: {
              id: VALID_B64U,
              name: 'alice@example.com',
              displayName: 'Alice',
            },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          },
        },
      },
    });
    vi.mocked(registerWithWebAuthn).mockResolvedValue({
      ok: false,
      error: { ok: false, code: 'FALLBACK_REQUIRED' },
    });

    const result = await orchestrator.createChannel({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.SECURE,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'FALLBACK_REQUIRED',
        stage: 'create.register',
      },
    });
    expect(vi.mocked(apiClient.createFinish)).not.toHaveBeenCalled();
    expect(useCreateStore.getState().createFinish.status).toBe('error');
    expect(useCreateStore.getState().createFinish.errorCode).toBe('FALLBACK_REQUIRED');
  });

  it('fails create channel when backend returns ATTESTATION_UNVERIFIABLE', async () => {
    const { orchestrator, apiClient } = createOrchestrator();

    vi.mocked(apiClient.createBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        creationOptions: { publicKey: {} },
      },
    });
    vi.mocked(registerWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ATTESTATION,
    });
    vi.mocked(apiClient.createFinish).mockResolvedValue({
      ok: false,
      error: {
        ok: false,
        code: 'ATTESTATION_UNVERIFIABLE',
        status: 403,
      },
    });

    const result = await orchestrator.createChannel({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.SECURE,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'ATTESTATION_UNVERIFIABLE',
        stage: 'create.finish',
      },
    });
    expect(useCreateStore.getState().createFinish.status).toBe('error');
    expect(useCreateStore.getState().createFinish.errorCode).toBe('ATTESTATION_UNVERIFIABLE');
  });

  it('returns wrappedPrivateKey in result for compatibility (password) mode', async () => {
    const { orchestrator, apiClient } = createOrchestrator();

    vi.mocked(apiClient.createBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true, creationOptions: {} },
    });
    vi.mocked(apiClient.createFinish).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        shareUrl: '/s/aaaaaaaaaaaaaaaaaaaaa',
        manageUrl: '/m/aaaaaaaaaaaaaaaaaaaaa',
      },
    });

    const result = await orchestrator.createChannel({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.QUICK,
      useCompatibilityMode: true,
      softkeyPassphrase: 'Compat#Pass123',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.wrappedPrivateKey).toBeDefined();
    expect(result.data.wrappedPrivateKey?.encryptedKey).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(result.data.wrappedPrivateKey?.iv).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(result.data.wrappedPrivateKey?.kdf.kdfType).toBe('argon2id');
  });
});
