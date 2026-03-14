// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import {
  AES_GCM,
  type AssertionJSON,
  type AttestationJSON,
  Base64UrlSchema,
  CHANNEL_STATE,
  type CreateBeginResponse,
  type DecryptFetchResponse,
  type HexString,
  HexStringSchema,
  type LockBeginResponse,
  MAX_PLAINTEXT_BYTES,
  type RSAPublicKeyJWK,
  SECURITY_PROFILE,
  type SecurityProfile,
  UnixMsSchema,
  UUIDSchema,
} from '@zerolink/shared';
import { exportReceiverPublicKeyToJwk, generateReceiverKeyPair } from '@zerolink/shared/crypto/rsa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../crypto/webauthn', async () => {
  const actual = await vi.importActual<typeof import('../crypto/webauthn')>('../crypto/webauthn');
  return {
    ...actual,
    registerWithWebAuthn: vi.fn(),
    assertWithWebAuthn: vi.fn(),
  };
});

import type { ApiClient } from '../api/client';
import {
  type CryptoOrchestrator,
  type CryptoOrchestratorDeps,
  createCryptoOrchestrator,
} from '../crypto/orchestrator';
import {
  createIndexedDbPendingSoftkeyCleanupStorage,
  createIndexedDbReceiverKeyStorage,
  createIndexedDbSoftkeyAdminStorage,
  type SoftkeyAdminEnvelope,
} from '../crypto/storage';
import {
  assertWithWebAuthn,
  registerWithWebAuthn,
  type WebAuthnAdapterResult,
} from '../crypto/webauthn';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';

const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const VALID_HEX = HexStringSchema.parse(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);
const VALID_B64U = Base64UrlSchema.parse('bW9ja19iYXNlNjR1cmw');
const VALID_LOCK_SECRET = Base64UrlSchema.parse('bW9ja19sb2NrX3NlY3JldF8xMjM0NTY3ODkwMTIzNDU');
const NOW = UnixMsSchema.parse(1_700_000_000_000);
const CHALLENGE_EXPIRES_AT = UnixMsSchema.parse(Number(NOW) + 60_000);
const VALID_UUID_BRANDED = UUIDSchema.parse(VALID_UUID);
const NEXT_UUID_BRANDED = UUIDSchema.parse('bbbbbbbbbbbbbbbbbbbbb');

function toMutableReceiverJwk(jwk: RSAPublicKeyJWK): {
  kty: 'RSA';
  alg: 'RSA-OAEP-256';
  n: RSAPublicKeyJWK['n'];
  e: RSAPublicKeyJWK['e'];
  ext: true;
  key_ops: ['encrypt'];
} {
  return {
    ...jwk,
    key_ops: ['encrypt'],
  };
}

async function computeReceiverPubFpr(publicKey: CryptoKey): Promise<HexString> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
  const digest = await crypto.subtle.digest('SHA-256', spki);
  return HexStringSchema.parse(
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  );
}

const VALID_ATTESTATION: AttestationJSON = {
  id: VALID_B64U,
  rawId: VALID_B64U,
  type: 'public-key',
  response: {
    clientDataJSON: VALID_B64U,
    attestationObject: VALID_B64U,
    transports: ['internal'],
  },
};

const VALID_ASSERTION: AssertionJSON = {
  id: VALID_B64U,
  rawId: VALID_B64U,
  type: 'public-key',
  response: {
    clientDataJSON: VALID_B64U,
    authenticatorData: VALID_B64U,
    signature: VALID_B64U,
    userHandle: null,
  },
};

const VALID_ALLOW_CREDENTIALS = [{ id: VALID_B64U, type: 'public-key' as const }];

function buildSoftkeyAdminEnvelope(createdAt: number): SoftkeyAdminEnvelope {
  return {
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
    createdAt,
  };
}

function createApiClientMock(): ApiClient {
  return {
    createBegin: vi.fn(),
    createFinish: vi.fn(),
    lockBegin: vi.fn(),
    lockCommit: vi.fn(),
    compoundBegin: vi.fn(),
    compoundCommit: vi.fn(),
    deleteCommit: vi.fn(),
    publicStatus: vi.fn(),
    decryptFetch: vi.fn(),
  };
}

function createOrchestrator(overrides: Partial<CryptoOrchestratorDeps> = {}): {
  orchestrator: CryptoOrchestrator;
  apiClient: ApiClient;
} {
  const apiClient = overrides.apiClient ?? createApiClientMock();

  const orchestrator = createCryptoOrchestrator({
    apiClient,
    receiverKeyStorage:
      overrides.receiverKeyStorage ??
      createIndexedDbReceiverKeyStorage({
        dbName: `test-orchestrator-db-${Math.random().toString(16).slice(2)}`,
        storeName: 'receiver-keys',
      }),
    softkeyAdminStorage:
      overrides.softkeyAdminStorage ??
      createIndexedDbSoftkeyAdminStorage({
        dbName: `test-orchestrator-softkey-${Math.random().toString(16).slice(2)}`,
        storeName: 'softkey-admin',
      }),
    pendingSoftkeyCleanupStorage:
      overrides.pendingSoftkeyCleanupStorage ??
      createIndexedDbPendingSoftkeyCleanupStorage({
        dbName: `test-orchestrator-softkey-pending-${Math.random().toString(16).slice(2)}`,
        storeName: 'pending-softkey-cleanup',
      }),
    createStore: overrides.createStore ?? useCreateStore,
    lockStore: overrides.lockStore ?? useLockStore,
    deliverStore: overrides.deliverStore ?? useDeliverStore,
    decryptStore: overrides.decryptStore ?? useDecryptStore,
    now: overrides.now ?? (() => NOW),
    randomBytes:
      overrides.randomBytes ??
      ((length) => {
        const out = new Uint8Array(length);
        for (let index = 0; index < length; index += 1) out[index] = (index + 1) % 255;
        return out;
      }),
  });

  return { orchestrator, apiClient };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

async function deliverAndCaptureCipherBundle(
  profile: SecurityProfile
): Promise<DecryptFetchResponse['cipherBundle']> {
  const { orchestrator, apiClient } = createOrchestrator();
  const receiverKeyPair = await generateReceiverKeyPair();
  const receiverPubJwk = await exportReceiverPublicKeyToJwk(receiverKeyPair.publicKey);
  const receiverPubFpr = await computeReceiverPubFpr(receiverKeyPair.publicKey);

  vi.mocked(apiClient.compoundBegin).mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      ok: true,
      challenge: {
        id: VALID_B64U,
        seed: VALID_B64U,
        expiresAt: CHALLENGE_EXPIRES_AT,
      },
      receiverPubFpr,
      receiverPubJwk: toMutableReceiverJwk(receiverPubJwk),
      currentVersion: 0,
      securityProfile: profile,
      adminMode: 'webauthn',
    },
  });
  vi.mocked(assertWithWebAuthn).mockResolvedValue({
    ok: true,
    data: VALID_ASSERTION,
  } satisfies WebAuthnAdapterResult<AssertionJSON>);

  let committedCipherBundle: DecryptFetchResponse['cipherBundle'] | null = null;
  vi.mocked(apiClient.compoundCommit).mockImplementation(async (input) => {
    if (input.intent.op === 'update') {
      committedCipherBundle = input.intent.cipherBundle as DecryptFetchResponse['cipherBundle'];
    }
    return { ok: true, status: 200, data: { ok: true } };
  });

  const deliverResult = await orchestrator.deliverSecret({
    uuid: VALID_UUID,
    profile,
    plaintext: 'padding coverage',
  });

  expect(deliverResult.ok).toBe(true);
  expect(committedCipherBundle).not.toBeNull();
  if (!committedCipherBundle) {
    throw new Error('Expected a committed cipher bundle');
  }

  return committedCipherBundle;
}

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

describe('crypto orchestrator', () => {
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

    expect(result.data.shareUrlWithFragment).toContain('#k=');
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

  it('runs lock flow and stores wrapped private key envelope', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-lock',
      storeName: 'receiver-keys',
    });
    const { orchestrator, apiClient } = createOrchestrator({
      receiverKeyStorage: storage,
    });

    const lockBeginResponse: LockBeginResponse = {
      ok: true,
      lockChallenge: {
        id: VALID_B64U,
        challenge: VALID_B64U,
        expiresAt: CHALLENGE_EXPIRES_AT,
      },
    };

    vi.mocked(apiClient.lockBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: lockBeginResponse,
    });
    vi.mocked(apiClient.lockCommit).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
    });

    const result = await orchestrator.lockChannel({
      uuid: VALID_UUID,
      lockSecretB64u: VALID_LOCK_SECRET,
      passphrase: 'Strong#Pass1234',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const savedEnvelope = await storage.load(VALID_UUID);
    expect(savedEnvelope).not.toBeNull();
    expect(savedEnvelope?.receiverPubFpr).toBe(result.data.receiverPubFpr);
    expect(useLockStore.getState().step).toBe('locked');
    expect(useLockStore.getState().passphrase).toBe('');
    expect(useLockStore.getState().safetyCode).not.toBeNull();
    expect(vi.mocked(apiClient.lockCommit)).toHaveBeenCalledTimes(1);
  });

  it('returns INVALID_LOCK_SECRET without calling lockBegin', async () => {
    const { orchestrator, apiClient } = createOrchestrator();

    const result = await orchestrator.lockChannel({
      uuid: VALID_UUID,
      lockSecretB64u: 'invalid+secret',
      passphrase: 'Strong#Pass1234',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'INVALID_LOCK_SECRET',
        stage: 'lock.validate',
      },
    });
    expect(vi.mocked(apiClient.lockBegin)).not.toHaveBeenCalled();
  });

  it('returns KEY_STORAGE_ERROR when receiver key save fails and blocks lock commit', async () => {
    const receiverKeyStorage = {
      save: vi.fn(async () => {
        throw Object.assign(new Error('db write failed'), {
          code: 'KEY_STORAGE_ERROR',
        });
      }),
      load: vi.fn(async () => null),
      remove: vi.fn(async () => {}),
    };
    const { orchestrator, apiClient } = createOrchestrator({
      receiverKeyStorage,
    });

    vi.mocked(apiClient.lockBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        lockChallenge: {
          id: VALID_B64U,
          challenge: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
      },
    });

    const result = await orchestrator.lockChannel({
      uuid: VALID_UUID,
      lockSecretB64u: VALID_LOCK_SECRET,
      passphrase: 'Strong#Pass1234',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'KEY_STORAGE_ERROR',
        stage: 'lock.persist',
      },
    });
    expect(vi.mocked(apiClient.lockCommit)).not.toHaveBeenCalled();
  });

  it('runs deliver flow and marks delivered state', async () => {
    const { orchestrator, apiClient } = createOrchestrator();
    const receiverKeyPair = await generateReceiverKeyPair();
    const receiverPubJwk = await exportReceiverPublicKeyToJwk(receiverKeyPair.publicKey);
    const receiverPubFpr = await computeReceiverPubFpr(receiverKeyPair.publicKey);

    vi.mocked(apiClient.compoundBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        allowCredentials: VALID_ALLOW_CREDENTIALS,
        receiverPubFpr,
        receiverPubJwk: toMutableReceiverJwk(receiverPubJwk),
        currentVersion: 0,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });
    vi.mocked(assertWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ASSERTION,
    } satisfies WebAuthnAdapterResult<AssertionJSON>);
    vi.mocked(apiClient.compoundCommit).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
    });

    const result = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      plaintext: 'hello from sender',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.intent.op).toBe('update');
    expect(result.data.intentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(useDeliverStore.getState().channelState).toBe(CHANNEL_STATE.DELIVERED);
    expect(vi.mocked(assertWithWebAuthn)).toHaveBeenCalledWith({
      profile: SECURITY_PROFILE.STANDARD,
      requestOptions: {
        publicKey: expect.objectContaining({
          allowCredentials: VALID_ALLOW_CREDENTIALS,
        }),
      },
    });
  });

  it('binds AAD to uuid, version, and receiverPubFpr', async () => {
    const { orchestrator, apiClient } = createOrchestrator();
    const receiverKeyPair = await generateReceiverKeyPair();
    const receiverPubJwk = await exportReceiverPublicKeyToJwk(receiverKeyPair.publicKey);
    const receiverPubFpr = await computeReceiverPubFpr(receiverKeyPair.publicKey);
    const currentVersion = 0;

    vi.mocked(apiClient.compoundBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        allowCredentials: VALID_ALLOW_CREDENTIALS,
        receiverPubFpr,
        receiverPubJwk: toMutableReceiverJwk(receiverPubJwk),
        currentVersion,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });
    vi.mocked(assertWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ASSERTION,
    } satisfies WebAuthnAdapterResult<AssertionJSON>);

    const captured: { aad: string | null } = { aad: null };
    vi.mocked(apiClient.compoundCommit).mockImplementation(async (input) => {
      if (input.intent.op === 'update') {
        captured.aad = input.intent.cipherBundle?.aad ?? null;
      }
      return { ok: true, status: 200, data: { ok: true } };
    });

    const result = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      plaintext: 'test aad binding',
    });

    expect(result.ok).toBe(true);
    if (captured.aad == null) {
      throw new Error('Expected a committed AAD value');
    }

    // Decode the base64url AAD and verify it contains uuid||version||fpr
    const aadBytes = Uint8Array.from(
      atob(captured.aad.replaceAll('-', '+').replaceAll('_', '/')),
      (c) => c.charCodeAt(0)
    );
    const aadText = new TextDecoder().decode(aadBytes);
    expect(aadText).toBe(`${VALID_UUID}||${currentVersion}||${receiverPubFpr}`);
  });

  it('does not apply deliver store updates when uuid changes mid-flow', async () => {
    const { orchestrator, apiClient } = createOrchestrator();
    useDeliverStore.getState().setDeliverUuid(VALID_UUID_BRANDED);

    const receiverKeyPair = await generateReceiverKeyPair();
    const receiverPubJwk = await exportReceiverPublicKeyToJwk(receiverKeyPair.publicKey);
    const receiverPubFpr = await computeReceiverPubFpr(receiverKeyPair.publicKey);

    const beginDeferred = createDeferred<Awaited<ReturnType<ApiClient['compoundBegin']>>>();
    vi.mocked(apiClient.compoundBegin).mockImplementation(async () => beginDeferred.promise);
    vi.mocked(assertWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ASSERTION,
    } satisfies WebAuthnAdapterResult<AssertionJSON>);
    vi.mocked(apiClient.compoundCommit).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
    });

    const deliverPromise = orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      plaintext: 'hello from sender',
    });

    useDeliverStore.getState().setDeliverUuid(NEXT_UUID_BRANDED);
    beginDeferred.resolve({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        receiverPubFpr,
        receiverPubJwk: toMutableReceiverJwk(receiverPubJwk),
        currentVersion: 0,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });

    const result = await deliverPromise;

    expect(result.ok).toBe(true);
    const state = useDeliverStore.getState();
    expect(state.uuid).toBe(NEXT_UUID_BRANDED);
    expect(state.channelState).toBe(CHANNEL_STATE.WAITING);
    expect(state.compoundCommit.status).toBe('idle');
  });

  it('returns MISSING_RECEIVER_IDENTITY when compound begin has no receiver fields', async () => {
    const { orchestrator, apiClient } = createOrchestrator();
    vi.mocked(apiClient.compoundBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        currentVersion: 0,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });

    const result = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      plaintext: 'hello from sender',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'MISSING_RECEIVER_IDENTITY',
        stage: 'deliver.validate',
      },
    });
    expect(vi.mocked(apiClient.compoundCommit)).not.toHaveBeenCalled();
  });

  it('returns CRYPTO_ERROR when deliver encryption pipeline throws', async () => {
    const { orchestrator, apiClient } = createOrchestrator();
    const receiverKeyPair = await generateReceiverKeyPair();
    const receiverPubJwk = await exportReceiverPublicKeyToJwk(receiverKeyPair.publicKey);
    const receiverPubFpr = await computeReceiverPubFpr(receiverKeyPair.publicKey);

    vi.mocked(apiClient.compoundBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        receiverPubFpr,
        receiverPubJwk: toMutableReceiverJwk(receiverPubJwk),
        currentVersion: 0,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });

    const result = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      plaintext: new Uint8Array(MAX_PLAINTEXT_BYTES + 1),
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        ok: false,
        code: 'CRYPTO_ERROR',
        stage: 'deliver.crypto',
      },
    });
    expect(vi.mocked(assertWithWebAuthn)).not.toHaveBeenCalled();
    expect(vi.mocked(apiClient.compoundCommit)).not.toHaveBeenCalled();
    expect(useDeliverStore.getState().compoundCommit.status).toBe('error');
    expect(useDeliverStore.getState().compoundCommit.errorCode).toBe('CRYPTO_ERROR');
  });

  it('uses 4 KB padding for quick profile delivery', async () => {
    const cipherBundle = await deliverAndCaptureCipherBundle(SECURITY_PROFILE.QUICK);

    expect(cipherBundle.padBlock).toBe(AES_GCM.PAD_BLOCK_DEFAULT);
  });

  it('uses 8 KB padding for secure profile delivery', async () => {
    const cipherBundle = await deliverAndCaptureCipherBundle(SECURITY_PROFILE.SECURE);

    expect(cipherBundle.padBlock).toBe(AES_GCM.PAD_BLOCK_STRICT);
  });

  it('uses 8 KB padding for strict legacy profile delivery', async () => {
    const cipherBundle = await deliverAndCaptureCipherBundle(SECURITY_PROFILE.STRICT);

    expect(cipherBundle.padBlock).toBe(AES_GCM.PAD_BLOCK_STRICT);
  });

  it('runs delete flow and marks deleted state', async () => {
    const { orchestrator, apiClient } = createOrchestrator();
    vi.mocked(apiClient.compoundBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        allowCredentials: VALID_ALLOW_CREDENTIALS,
        currentVersion: 3,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });
    vi.mocked(assertWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ASSERTION,
    } satisfies WebAuthnAdapterResult<AssertionJSON>);
    vi.mocked(apiClient.deleteCommit).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
    });

    const result = await orchestrator.deleteChannel({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
    });

    expect(result.ok).toBe(true);
    expect(useDeliverStore.getState().channelState).toBe(CHANNEL_STATE.DELETED);
    expect(vi.mocked(assertWithWebAuthn)).toHaveBeenCalledWith({
      profile: SECURITY_PROFILE.STANDARD,
      requestOptions: {
        publicKey: expect.objectContaining({
          allowCredentials: VALID_ALLOW_CREDENTIALS,
        }),
      },
    });
  });

  it('does not apply delete store updates when uuid changes mid-flow', async () => {
    const { orchestrator, apiClient } = createOrchestrator();
    useDeliverStore.getState().setDeliverUuid(VALID_UUID_BRANDED);

    const beginDeferred = createDeferred<Awaited<ReturnType<ApiClient['compoundBegin']>>>();
    vi.mocked(apiClient.compoundBegin).mockImplementation(async () => beginDeferred.promise);
    vi.mocked(assertWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ASSERTION,
    } satisfies WebAuthnAdapterResult<AssertionJSON>);
    vi.mocked(apiClient.deleteCommit).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
    });

    const deletePromise = orchestrator.deleteChannel({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
    });

    useDeliverStore.getState().setDeliverUuid(NEXT_UUID_BRANDED);
    beginDeferred.resolve({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        currentVersion: 3,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });

    const result = await deletePromise;

    expect(result.ok).toBe(true);
    const state = useDeliverStore.getState();
    expect(state.uuid).toBe(NEXT_UUID_BRANDED);
    expect(state.channelState).toBe(CHANNEL_STATE.WAITING);
    expect(state.compoundCommit.status).toBe('idle');
  });

  it('decrypts delivered payload and sets plaintext in decrypt store', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt',
      storeName: 'receiver-keys',
    });
    const { orchestrator, apiClient } = createOrchestrator({
      receiverKeyStorage: storage,
    });

    vi.mocked(apiClient.lockBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        lockChallenge: {
          id: VALID_B64U,
          challenge: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
      },
    });
    vi.mocked(apiClient.lockCommit).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
    });
    const lockResult = await orchestrator.lockChannel({
      uuid: VALID_UUID,
      lockSecretB64u: VALID_LOCK_SECRET,
      passphrase: 'Strong#Pass1234',
    });
    expect(lockResult.ok).toBe(true);
    if (!lockResult.ok) return;

    vi.mocked(apiClient.compoundBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        receiverPubFpr: lockResult.data.receiverPubFpr,
        receiverPubJwk: toMutableReceiverJwk(lockResult.data.receiverPubJwk),
        currentVersion: 0,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });
    vi.mocked(assertWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ASSERTION,
    } satisfies WebAuthnAdapterResult<AssertionJSON>);

    let committedCipherBundle: DecryptFetchResponse['cipherBundle'] | null = null;
    vi.mocked(apiClient.compoundCommit).mockImplementation(async (input) => {
      if (input.intent.op === 'update') {
        committedCipherBundle = input.intent.cipherBundle as DecryptFetchResponse['cipherBundle'];
      }
      return { ok: true, status: 200, data: { ok: true } };
    });

    const deliverResult = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      plaintext: 'receiver can decrypt this',
    });
    expect(deliverResult.ok).toBe(true);
    expect(committedCipherBundle).not.toBeNull();
    if (!committedCipherBundle) return;
    const deliveredCipherBundle = committedCipherBundle as DecryptFetchResponse['cipherBundle'];
    expect(deliveredCipherBundle.padBlock).toBe(AES_GCM.PAD_BLOCK_DEFAULT);

    vi.mocked(apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'webauthn' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: deliveredCipherBundle,
        receiverPubFpr: lockResult.data.receiverPubFpr,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });

    const decryptResult = await orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(decryptResult.ok).toBe(true);
    if (!decryptResult.ok) return;
    expect(decryptResult.data.plaintext).toBe('receiver can decrypt this');
    expect('plaintextBytes' in decryptResult.data).toBe(false);
    expect(useDecryptStore.getState().plaintext).toBe('receiver can decrypt this');
  });

  it('does not apply decrypt store updates when uuid changes mid-flow', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-mid-flow-scope',
      storeName: 'receiver-keys',
    });
    const { orchestrator, apiClient } = createOrchestrator({
      receiverKeyStorage: storage,
    });
    useDecryptStore.getState().setDecryptUuid(VALID_UUID_BRANDED);

    vi.mocked(apiClient.lockBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        lockChallenge: {
          id: VALID_B64U,
          challenge: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
      },
    });
    vi.mocked(apiClient.lockCommit).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
    });
    const lockResult = await orchestrator.lockChannel({
      uuid: VALID_UUID,
      lockSecretB64u: VALID_LOCK_SECRET,
      passphrase: 'Strong#Pass1234',
    });
    expect(lockResult.ok).toBe(true);
    if (!lockResult.ok) return;

    vi.mocked(apiClient.compoundBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        receiverPubFpr: lockResult.data.receiverPubFpr,
        receiverPubJwk: toMutableReceiverJwk(lockResult.data.receiverPubJwk),
        currentVersion: 0,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });
    vi.mocked(assertWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ASSERTION,
    } satisfies WebAuthnAdapterResult<AssertionJSON>);

    let committedCipherBundle: DecryptFetchResponse['cipherBundle'] | null = null;
    vi.mocked(apiClient.compoundCommit).mockImplementation(async (input) => {
      if (input.intent.op === 'update') {
        committedCipherBundle = input.intent.cipherBundle as DecryptFetchResponse['cipherBundle'];
      }
      return { ok: true, status: 200, data: { ok: true } };
    });

    const deliverResult = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      plaintext: 'receiver can decrypt this',
    });
    expect(deliverResult.ok).toBe(true);
    expect(committedCipherBundle).not.toBeNull();
    if (!committedCipherBundle) return;

    const statusDeferred = createDeferred<Awaited<ReturnType<ApiClient['publicStatus']>>>();
    vi.mocked(apiClient.publicStatus).mockImplementation(async () => statusDeferred.promise);
    vi.mocked(apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: committedCipherBundle,
        receiverPubFpr: lockResult.data.receiverPubFpr,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });

    const decryptPromise = orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(useDecryptStore.getState().publicStatus.status).toBe('loading');

    useDecryptStore.getState().setDecryptUuid(NEXT_UUID_BRANDED);
    useDecryptStore.getState().setPlaintext('next-uuid-local-plaintext');

    statusDeferred.resolve({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'webauthn' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });

    const decryptResult = await decryptPromise;
    expect(decryptResult.ok).toBe(true);
    expect(vi.mocked(apiClient.decryptFetch)).toHaveBeenCalledWith(VALID_UUID);

    const state = useDecryptStore.getState();
    expect(state.uuid).toBe(NEXT_UUID_BRANDED);
    expect(state.channelState).toBe(CHANNEL_STATE.WAITING);
    expect(state.publicStatus.status).toBe('idle');
    expect(state.decryptFetch.status).toBe('idle');
    expect(state.plaintext).toBe('next-uuid-local-plaintext');
  });

  it('returns CHANNEL_NOT_DELIVERED when public state is not delivered', async () => {
    const { orchestrator, apiClient } = createOrchestrator();
    vi.mocked(apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.WAITING,
        adminMode: 'webauthn' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });

    const result = await orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'CHANNEL_NOT_DELIVERED',
        stage: 'decrypt.public-status',
      },
    });
    expect(vi.mocked(apiClient.decryptFetch)).not.toHaveBeenCalled();
  });

  it('returns INTEGRITY_MISMATCH when decrypt payload hash is invalid', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-integrity',
      storeName: 'receiver-keys',
    });
    const { orchestrator, apiClient } = createOrchestrator({
      receiverKeyStorage: storage,
    });

    await storage.save({
      uuid: VALID_UUID,
      receiverPubFpr: VALID_HEX,
      wrappedPrivateKey: {
        encryptedKey: VALID_B64U,
        iv: VALID_B64U,
        kdf: {
          kdfType: 'argon2id',
          version: 19,
          m: 65536,
          t: 3,
          p: 4,
          salt: VALID_B64U,
        },
      },
      updatedAt: Number(NOW),
    });

    vi.mocked(apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'webauthn' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: {
          ciphertext: VALID_B64U,
          iv: VALID_B64U,
          aad: VALID_B64U,
          encContentKey: VALID_B64U,
          ciphertextHash: HexStringSchema.parse(
            'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
          ),
          padBlock: 4096,
        },
        receiverPubFpr: VALID_HEX,
        deliveredAt: NOW,
      },
    });

    const result = await orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'INTEGRITY_MISMATCH',
        stage: 'decrypt.verify',
      },
    });
  });

  it('returns PASSPHRASE_REQUIRED when passphrase is shorter than 8 characters (L-5)', async () => {
    const { orchestrator, apiClient } = createOrchestrator();
    const receiverKeyPair = await generateReceiverKeyPair();
    const receiverPubJwk = await exportReceiverPublicKeyToJwk(receiverKeyPair.publicKey);
    const receiverPubFpr = await computeReceiverPubFpr(receiverKeyPair.publicKey);

    const createResult = await orchestrator.createChannel({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.QUICK,
      useCompatibilityMode: true,
      softkeyPassphrase: 'short',
    });

    expect(createResult).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'PASSPHRASE_REQUIRED',
        stage: 'create.softkey-passphrase',
        message: 'passphrase must be at least 8 characters',
      },
    });
    expect(vi.mocked(apiClient.createBegin)).not.toHaveBeenCalled();

    const lockResult = await orchestrator.lockChannel({
      uuid: VALID_UUID,
      lockSecretB64u: VALID_LOCK_SECRET,
      passphrase: 'short',
    });

    expect(lockResult).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'PASSPHRASE_REQUIRED',
        stage: 'lock.validate',
        message: 'passphrase must be at least 8 characters',
      },
    });

    vi.mocked(apiClient.compoundBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        receiverPubFpr,
        receiverPubJwk: toMutableReceiverJwk(receiverPubJwk),
        currentVersion: 0,
        securityProfile: SECURITY_PROFILE.QUICK,
        adminMode: 'password',
      },
    });

    const deliverResult = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.QUICK,
      plaintext: 'hello from sender',
      softkeyPassphrase: '1234567',
    });

    expect(deliverResult).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'PASSPHRASE_REQUIRED',
        stage: 'deliver.softkey-passphrase',
        message: 'passphrase must be at least 8 characters',
      },
    });
    expect(vi.mocked(apiClient.compoundCommit)).not.toHaveBeenCalled();

    const deleteResult = await orchestrator.deleteChannel({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.QUICK,
      softkeyPassphrase: '1234567',
    });

    expect(deleteResult).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'PASSPHRASE_REQUIRED',
        stage: 'delete.softkey-passphrase',
        message: 'passphrase must be at least 8 characters',
      },
    });
    expect(vi.mocked(apiClient.deleteCommit)).not.toHaveBeenCalled();

    const decryptResult = await orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: '1234567',
    });

    expect(decryptResult).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'PASSPHRASE_REQUIRED',
        stage: 'decrypt.validate',
        message: 'passphrase must be at least 8 characters',
      },
    });
  });

  it('preserves receiver key storage after successful decryption so re-decrypt stays available', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-cleanup',
      storeName: 'receiver-keys',
    });
    const removeSpy = vi.spyOn(storage, 'remove');
    const { orchestrator, apiClient } = createOrchestrator({
      receiverKeyStorage: storage,
    });

    vi.mocked(apiClient.lockBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        lockChallenge: {
          id: VALID_B64U,
          challenge: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
      },
    });
    vi.mocked(apiClient.lockCommit).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
    });
    const lockResult = await orchestrator.lockChannel({
      uuid: VALID_UUID,
      lockSecretB64u: VALID_LOCK_SECRET,
      passphrase: 'Strong#Pass1234',
    });
    expect(lockResult.ok).toBe(true);
    if (!lockResult.ok) return;

    vi.mocked(apiClient.compoundBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        receiverPubFpr: lockResult.data.receiverPubFpr,
        receiverPubJwk: toMutableReceiverJwk(lockResult.data.receiverPubJwk),
        currentVersion: 0,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });
    vi.mocked(assertWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ASSERTION,
    } satisfies WebAuthnAdapterResult<AssertionJSON>);

    let committedCipherBundle: DecryptFetchResponse['cipherBundle'] | null = null;
    vi.mocked(apiClient.compoundCommit).mockImplementation(async (input) => {
      if (input.intent.op === 'update') {
        committedCipherBundle = input.intent.cipherBundle as DecryptFetchResponse['cipherBundle'];
      }
      return { ok: true, status: 200, data: { ok: true } };
    });

    const deliverResult = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      plaintext: 'cleanup test payload',
    });
    expect(deliverResult.ok).toBe(true);
    expect(committedCipherBundle).not.toBeNull();
    if (!committedCipherBundle) return;

    vi.mocked(apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'webauthn' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: committedCipherBundle as DecryptFetchResponse['cipherBundle'],
        receiverPubFpr: lockResult.data.receiverPubFpr,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });

    removeSpy.mockClear();
    const firstDecryptResult = await orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });
    const secondDecryptResult = await orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(firstDecryptResult.ok).toBe(true);
    expect(secondDecryptResult.ok).toBe(true);
    expect(removeSpy).not.toHaveBeenCalled();
    await expect(storage.load(VALID_UUID)).resolves.not.toBeNull();
  });

  it('returns INTEGRITY_MISMATCH when content key length is invalid (L-4)', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-key-length',
      storeName: 'receiver-keys',
    });
    const { orchestrator, apiClient } = createOrchestrator({
      receiverKeyStorage: storage,
    });

    vi.mocked(apiClient.lockBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        lockChallenge: {
          id: VALID_B64U,
          challenge: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
      },
    });
    vi.mocked(apiClient.lockCommit).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
    });
    const lockResult = await orchestrator.lockChannel({
      uuid: VALID_UUID,
      lockSecretB64u: VALID_LOCK_SECRET,
      passphrase: 'Strong#Pass1234',
    });
    expect(lockResult.ok).toBe(true);
    if (!lockResult.ok) return;

    vi.mocked(apiClient.compoundBegin).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        challenge: {
          id: VALID_B64U,
          seed: VALID_B64U,
          expiresAt: CHALLENGE_EXPIRES_AT,
        },
        receiverPubFpr: lockResult.data.receiverPubFpr,
        receiverPubJwk: toMutableReceiverJwk(lockResult.data.receiverPubJwk),
        currentVersion: 0,
        securityProfile: SECURITY_PROFILE.STANDARD,
        adminMode: 'webauthn',
      },
    });
    vi.mocked(assertWithWebAuthn).mockResolvedValue({
      ok: true,
      data: VALID_ASSERTION,
    } satisfies WebAuthnAdapterResult<AssertionJSON>);

    let committedCipherBundle: DecryptFetchResponse['cipherBundle'] | null = null;
    vi.mocked(apiClient.compoundCommit).mockImplementation(async (input) => {
      if (input.intent.op === 'update') {
        committedCipherBundle = input.intent.cipherBundle as DecryptFetchResponse['cipherBundle'];
      }
      return { ok: true, status: 200, data: { ok: true } };
    });

    const deliverResult = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.STANDARD,
      plaintext: 'key length test payload',
    });
    expect(deliverResult.ok).toBe(true);
    expect(committedCipherBundle).not.toBeNull();
    if (!committedCipherBundle) return;
    const deliveredCipherBundle = committedCipherBundle as DecryptFetchResponse['cipherBundle'];

    const tamperedBundle: DecryptFetchResponse['cipherBundle'] = {
      ...deliveredCipherBundle,
      ciphertextHash: deliveredCipherBundle.ciphertextHash,
      encContentKey: Base64UrlSchema.parse('dG9vc2hvcnQ'),
    };

    const ciphertextBytes = Uint8Array.from(
      atob(deliveredCipherBundle.ciphertext.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    );
    const hashBuffer = await crypto.subtle.digest('SHA-256', ciphertextBytes);
    const correctHash = HexStringSchema.parse(
      Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('')
    );
    tamperedBundle.ciphertextHash = correctHash;

    vi.mocked(apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'webauthn' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: tamperedBundle,
        receiverPubFpr: lockResult.data.receiverPubFpr,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });

    const decryptResult = await orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(decryptResult.ok).toBe(false);
    if (decryptResult.ok) return;
    expect(decryptResult.error.code).toMatch(/INTEGRITY_MISMATCH|CRYPTO_ERROR/u);
  });
});
