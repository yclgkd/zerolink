// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import {
  AES_GCM,
  CHANNEL_STATE,
  type DecryptFetchResponse,
  encodeFileSharePayload,
  SECURITY_PROFILE,
} from '@zerolink/shared';
import { exportReceiverPublicKeyToJwk, generateReceiverKeyPair } from '@zerolink/shared/crypto/rsa';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import {
  buildDeliveredDecryptFixtureBase,
  CHALLENGE_EXPIRES_AT,
  computeReceiverPubFpr,
  createDeferred,
  createOrchestrator,
  NEXT_UUID_BRANDED,
  NOW,
  seedDeliveredDecryptFixture,
  toMutableReceiverJwk,
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
  let deliveredDecryptBase: Awaited<ReturnType<typeof buildDeliveredDecryptFixtureBase>>;

  beforeAll(async () => {
    deliveredDecryptBase = await buildDeliveredDecryptFixtureBase();
  });

  it('decrypts delivered text payload and sets plaintext in decrypt store', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt',
      storeName: 'receiver-keys',
    });
    const prepared = await seedDeliveredDecryptFixture(deliveredDecryptBase, {
      receiverKeyStorage: storage,
    });

    expect(prepared.cipherBundle.padBlock).toBe(AES_GCM.PAD_BLOCK_STRICT);

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'webauthn' as const,
        securityProfile: SECURITY_PROFILE.SECURE,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: 0,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });

    const decryptResult = await prepared.orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(decryptResult.ok).toBe(true);
    if (!decryptResult.ok) return;
    expect(decryptResult.data.payload).toEqual(prepared.expectedPayload);
    expect(decryptResult.data.cipherVersion).toBe(0);
    expect(useDecryptStore.getState().plaintext).toBe(prepared.plaintext);
    expect(useDecryptStore.getState().file).toBeNull();
  });

  it('treats legacy inline file payloads as raw text instead of downloadable files', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-file',
      storeName: 'receiver-keys',
    });
    const legacyInlineFileEnvelope = encodeFileSharePayload({
      fileName: 'secret.bin',
      mediaType: 'application/octet-stream',
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    const expectedText = new TextDecoder().decode(legacyInlineFileEnvelope);
    const prepared = await seedDeliveredDecryptFixture(
      await buildDeliveredDecryptFixtureBase({
        receiverKeyStorage: storage,
        file: {
          fileName: 'secret.bin',
          mediaType: 'application/octet-stream',
          bytes: new Uint8Array([1, 2, 3, 4]),
        },
      }),
      {
        receiverKeyStorage: storage,
      }
    );

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'webauthn' as const,
        securityProfile: SECURITY_PROFILE.SECURE,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: 0,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });

    const decryptResult = await prepared.orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(decryptResult.ok).toBe(true);
    if (!decryptResult.ok) return;
    expect(decryptResult.data.payload).toEqual({
      kind: 'text',
      text: expectedText,
    });
    expect(useDecryptStore.getState().plaintext).toBe(expectedText);
    expect(useDecryptStore.getState().file).toBeNull();
  });

  it('does not apply decrypt store updates when uuid changes mid-flow', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-mid-flow-scope',
      storeName: 'receiver-keys',
    });
    const prepared = await seedDeliveredDecryptFixture(deliveredDecryptBase, {
      receiverKeyStorage: storage,
    });
    useDecryptStore.getState().setDecryptUuid(VALID_UUID_BRANDED);

    const statusDeferred = createDeferred<Awaited<ReturnType<ApiClient['publicStatus']>>>();
    vi.mocked(prepared.apiClient.publicStatus).mockImplementation(
      async () => statusDeferred.promise
    );
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: 0,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });

    const decryptPromise = prepared.orchestrator.decryptDelivered({
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
        securityProfile: SECURITY_PROFILE.SECURE,
      },
    });

    const decryptResult = await decryptPromise;
    expect(decryptResult.ok).toBe(true);
    expect(vi.mocked(prepared.apiClient.decryptFetch)).toHaveBeenCalledWith(VALID_UUID);

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
        securityProfile: SECURITY_PROFILE.SECURE,
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

  it('returns PASSPHRASE_REQUIRED when passphrase is shorter than 12 characters (L-5)', async () => {
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
        message: 'Channel password must be at least 12 characters',
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
        message: 'Passphrase must be at least 12 characters',
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
        message: 'Channel password must be at least 12 characters',
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
        message: 'Channel password must be at least 12 characters',
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
        message: 'Passphrase must be at least 12 characters',
      },
    });
  });

  it('preserves receiver key storage after successful decryption so re-decrypt stays available', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-cleanup',
      storeName: 'receiver-keys',
    });
    const removeSpy = vi.spyOn(storage, 'remove');
    const base = await buildDeliveredDecryptFixtureBase({
      plaintext: 'cleanup test payload',
    });
    const prepared = await seedDeliveredDecryptFixture(base, {
      receiverKeyStorage: storage,
    });

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'webauthn' as const,
        securityProfile: SECURITY_PROFILE.SECURE,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: 0,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });

    removeSpy.mockClear();
    const firstDecryptResult = await prepared.orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });
    const secondDecryptResult = await prepared.orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(firstDecryptResult.ok).toBe(true);
    expect(secondDecryptResult.ok).toBe(true);
    expect(removeSpy).not.toHaveBeenCalled();
    await expect(storage.load(VALID_UUID)).resolves.toMatchObject({
      lastAcceptedDelivery: {
        version: 0,
        ciphertextHash: prepared.cipherBundle.ciphertextHash,
      },
    });
  });
});
