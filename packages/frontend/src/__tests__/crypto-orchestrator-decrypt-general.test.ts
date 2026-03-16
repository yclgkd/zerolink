// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import {
  AES_GCM,
  type AssertionJSON,
  CHANNEL_STATE,
  type DecryptFetchResponse,
  SECURITY_PROFILE,
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
import { createIndexedDbReceiverKeyStorage } from '../crypto/storage';
import { assertWithWebAuthn, type WebAuthnAdapterResult } from '../crypto/webauthn';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import {
  CHALLENGE_EXPIRES_AT,
  computeReceiverPubFpr,
  createDeferred,
  createOrchestrator,
  NEXT_UUID_BRANDED,
  NOW,
  toMutableReceiverJwk,
  VALID_ASSERTION,
  VALID_B64U,
  VALID_LOCK_SECRET,
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

describe('crypto orchestrator – decryptDelivered (general)', () => {
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
        cipherVersion: 0,
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
    expect(decryptResult.data.cipherVersion).toBe(0);
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
        cipherVersion: 0,
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
        cipherVersion: 0,
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
    await expect(storage.load(VALID_UUID)).resolves.toMatchObject({
      lastAcceptedDelivery: {
        version: 0,
        ciphertextHash: (committedCipherBundle as DecryptFetchResponse['cipherBundle'])
          .ciphertextHash,
      },
    });
  });
});
