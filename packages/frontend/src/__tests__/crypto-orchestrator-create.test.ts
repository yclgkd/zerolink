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

import {
  createIndexedDbPendingSoftkeyCleanupStorage,
  createIndexedDbSoftkeyAdminStorage,
} from '../crypto/storage';
import { registerWithWebAuthn, type WebAuthnAdapterResult } from '../crypto/webauthn';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import {
  buildSoftkeyAdminEnvelope,
  createOrchestrator,
  extractSenderAuthFprFromShareUrl,
  NOW,
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
      profile: SECURITY_PROFILE.STANDARD,
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
    expect(useCreateStore.getState().createdProfile).toBe(SECURITY_PROFILE.STANDARD);
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
      profile: SECURITY_PROFILE.STANDARD,
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
      profile: SECURITY_PROFILE.HARDWARE_ONLY,
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

  it('removes softkey admin envelope when compatibility createFinish fails', async () => {
    const softkeyAdminStorage = createIndexedDbSoftkeyAdminStorage({
      dbName: `test-orchestrator-softkey-cleanup-${Math.random().toString(16).slice(2)}`,
      storeName: 'softkey-admin',
    });
    const { orchestrator, apiClient } = createOrchestrator({
      softkeyAdminStorage,
    });

    vi.mocked(apiClient.createBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        creationOptions: {},
      },
    });
    vi.mocked(apiClient.createFinish).mockResolvedValue({
      ok: false,
      error: {
        ok: false,
        code: 'HTTP_ERROR',
        status: 500,
      },
    });

    const result = await orchestrator.createChannel({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      useCompatibilityMode: true,
      softkeyPassphrase: 'Compat#Pass123',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'HTTP_ERROR',
        stage: 'create.finish',
      },
    });
    expect(await softkeyAdminStorage.load(VALID_UUID)).toBeNull();
    expect(useCreateStore.getState().createFinish.status).toBe('error');
    expect(useCreateStore.getState().createFinish.errorCode).toBe('HTTP_ERROR');
  });

  it('preserves create finish error when compatibility cleanup fails', async () => {
    const softkeyAdminStorage = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => null),
      remove: vi.fn(async () => {
        throw new Error('cleanup failed');
      }),
    };
    const pendingSoftkeyCleanupStorage = {
      mark: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      clear: vi.fn(async () => {}),
    };
    const { orchestrator, apiClient } = createOrchestrator({
      softkeyAdminStorage,
      pendingSoftkeyCleanupStorage,
    });

    vi.mocked(apiClient.createBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        creationOptions: {},
      },
    });
    vi.mocked(apiClient.createFinish).mockResolvedValue({
      ok: false,
      error: {
        ok: false,
        code: 'HTTP_ERROR',
        status: 500,
      },
    });

    const result = await orchestrator.createChannel({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      useCompatibilityMode: true,
      softkeyPassphrase: 'Compat#Pass123',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'HTTP_ERROR',
        stage: 'create.finish',
        message: 'cleanup failed after create.finish',
      },
    });
    expect(softkeyAdminStorage.remove).toHaveBeenCalledWith(VALID_UUID);
    expect(pendingSoftkeyCleanupStorage.mark).toHaveBeenCalledWith(VALID_UUID, NOW);
    expect(useCreateStore.getState().createFinish.status).toBe('error');
    expect(useCreateStore.getState().createFinish.errorCode).toBe('HTTP_ERROR');
  });

  it('keeps create finish error when pending cleanup mark fails', async () => {
    const softkeyAdminStorage = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => null),
      remove: vi.fn(async () => {
        throw new Error('cleanup failed');
      }),
    };
    const pendingSoftkeyCleanupStorage = {
      mark: vi.fn(async () => {
        throw new Error('mark failed');
      }),
      list: vi.fn(async () => []),
      clear: vi.fn(async () => {}),
    };
    const { orchestrator, apiClient } = createOrchestrator({
      softkeyAdminStorage,
      pendingSoftkeyCleanupStorage,
    });

    vi.mocked(apiClient.createBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        creationOptions: {},
      },
    });
    vi.mocked(apiClient.createFinish).mockResolvedValue({
      ok: false,
      error: {
        ok: false,
        code: 'HTTP_ERROR',
        status: 500,
      },
    });

    const result = await orchestrator.createChannel({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      useCompatibilityMode: true,
      softkeyPassphrase: 'Compat#Pass123',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'HTTP_ERROR',
        stage: 'create.finish',
        message: 'cleanup failed after create.finish',
      },
    });
    expect(pendingSoftkeyCleanupStorage.mark).toHaveBeenCalledWith(VALID_UUID, NOW);
    expect(useCreateStore.getState().createFinish.status).toBe('error');
    expect(useCreateStore.getState().createFinish.errorCode).toBe('HTTP_ERROR');
  });

  it('retries pending softkey cleanup on next create and clears pending records', async () => {
    const softkeyDbName = `test-orchestrator-softkey-retry-${Math.random().toString(16).slice(2)}`;
    const pendingDbName = `test-orchestrator-softkey-pending-retry-${Math.random()
      .toString(16)
      .slice(2)}`;

    const softkeyAdminStorage = createIndexedDbSoftkeyAdminStorage({
      dbName: softkeyDbName,
      storeName: 'softkey-admin',
    });
    const pendingSoftkeyCleanupStorage = createIndexedDbPendingSoftkeyCleanupStorage({
      dbName: pendingDbName,
      storeName: 'pending-softkey-cleanup',
    });

    await softkeyAdminStorage.save({
      uuid: VALID_UUID,
      softkeyPubJwk: {
        kty: 'EC',
        crv: 'P-256',
        x: VALID_B64U,
        y: VALID_B64U,
        ext: true,
        key_ops: ['verify'],
      },
      wrappedPrivateKey: {
        encryptedKey: VALID_B64U,
        iv: VALID_B64U,
        kdf: {
          kdfType: 'argon2id',
          version: 19,
          m: 65_536,
          t: 3,
          p: 1,
          salt: VALID_B64U,
        },
      },
      createdAt: NOW - 2,
    });
    await pendingSoftkeyCleanupStorage.mark(VALID_UUID, NOW - 1);

    const { orchestrator, apiClient } = createOrchestrator({
      softkeyAdminStorage,
      pendingSoftkeyCleanupStorage,
    });

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
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
    });

    expect(result.ok).toBe(true);
    expect(await softkeyAdminStorage.load(VALID_UUID)).toBeNull();
    expect(await pendingSoftkeyCleanupStorage.list()).toEqual([]);
  });

  it('keeps pending softkey cleanup record when retry remove fails', async () => {
    const pendingSoftkeyCleanupStorage = {
      mark: vi.fn(async () => {}),
      list: vi.fn(async () => [{ uuid: VALID_UUID, markedAt: NOW - 1 }]),
      clear: vi.fn(async () => {}),
    };
    const softkeyAdminStorage = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => buildSoftkeyAdminEnvelope(Number(NOW) - 2)),
      remove: vi.fn(async () => {
        throw new Error('remove failed');
      }),
    };
    const { orchestrator, apiClient } = createOrchestrator({
      softkeyAdminStorage,
      pendingSoftkeyCleanupStorage,
    });

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
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
    });

    expect(result.ok).toBe(true);
    expect(softkeyAdminStorage.remove).toHaveBeenCalledWith(VALID_UUID);
    expect(pendingSoftkeyCleanupStorage.clear).not.toHaveBeenCalled();
  });

  it('continues create flow when pending cleanup list fails', async () => {
    const pendingSoftkeyCleanupStorage = {
      mark: vi.fn(async () => {}),
      list: vi.fn(async () => {
        throw new Error('list failed');
      }),
      clear: vi.fn(async () => {}),
    };
    const { orchestrator, apiClient } = createOrchestrator({
      pendingSoftkeyCleanupStorage,
    });

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
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
    });

    expect(result.ok).toBe(true);
    expect(pendingSoftkeyCleanupStorage.list).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiClient.createBegin)).toHaveBeenCalledTimes(1);
  });

  it('clears pending record when no softkey envelope exists during retry', async () => {
    const pendingSoftkeyCleanupStorage = {
      mark: vi.fn(async () => {}),
      list: vi.fn(async () => [{ uuid: VALID_UUID, markedAt: NOW - 1 }]),
      clear: vi.fn(async () => {}),
    };
    const softkeyAdminStorage = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => null),
      remove: vi.fn(async () => {}),
    };
    const { orchestrator, apiClient } = createOrchestrator({
      softkeyAdminStorage,
      pendingSoftkeyCleanupStorage,
    });

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
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
    });

    expect(result.ok).toBe(true);
    expect(softkeyAdminStorage.remove).not.toHaveBeenCalled();
    expect(pendingSoftkeyCleanupStorage.clear).toHaveBeenCalledWith(VALID_UUID);
  });

  it('clears stale pending record when a newer softkey envelope exists', async () => {
    const pendingSoftkeyCleanupStorage = {
      mark: vi.fn(async () => {}),
      list: vi.fn(async () => [{ uuid: VALID_UUID, markedAt: NOW - 10 }]),
      clear: vi.fn(async () => {}),
    };
    const softkeyAdminStorage = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => buildSoftkeyAdminEnvelope(Number(NOW))),
      remove: vi.fn(async () => {}),
    };
    const { orchestrator, apiClient } = createOrchestrator({
      softkeyAdminStorage,
      pendingSoftkeyCleanupStorage,
    });

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
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
    });

    expect(result.ok).toBe(true);
    expect(softkeyAdminStorage.remove).not.toHaveBeenCalled();
    expect(pendingSoftkeyCleanupStorage.clear).toHaveBeenCalledWith(VALID_UUID);
  });

  it('removes pending softkey envelope when createdAt equals markedAt', async () => {
    const pendingSoftkeyCleanupStorage = {
      mark: vi.fn(async () => {}),
      list: vi.fn(async () => [{ uuid: VALID_UUID, markedAt: NOW }]),
      clear: vi.fn(async () => {}),
    };
    const softkeyAdminStorage = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => buildSoftkeyAdminEnvelope(Number(NOW))),
      remove: vi.fn(async () => {}),
    };
    const { orchestrator, apiClient } = createOrchestrator({
      softkeyAdminStorage,
      pendingSoftkeyCleanupStorage,
    });

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
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
    });

    expect(result.ok).toBe(true);
    expect(softkeyAdminStorage.remove).toHaveBeenCalledWith(VALID_UUID);
    expect(pendingSoftkeyCleanupStorage.clear).toHaveBeenCalledWith(VALID_UUID);
  });
});
