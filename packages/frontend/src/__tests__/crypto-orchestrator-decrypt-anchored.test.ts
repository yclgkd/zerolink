// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import {
  CHANNEL_STATE,
  type DecryptFetchResponse,
  HexStringSchema,
  SECURITY_PROFILE,
} from '@zerolink/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../crypto/webauthn', async () => {
  const actual = await vi.importActual<typeof import('../crypto/webauthn')>('../crypto/webauthn');
  return {
    ...actual,
    registerWithWebAuthn: vi.fn(),
    assertWithWebAuthn: vi.fn(),
  };
});

import { exportSoftkeyPublicJwk, generateSoftkeyPair } from '../crypto/softkey';
import { createIndexedDbReceiverKeyStorage, type ReceiverKeyEnvelope } from '../crypto/storage';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import {
  buildAnchoredSoftkeyDeliveryBase,
  NOW,
  prepareAnchoredSoftkeyDelivery,
  VALID_UUID,
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

describe('crypto orchestrator – decryptDelivered (anchored softkey)', () => {
  let anchoredBase: Awaited<ReturnType<typeof buildAnchoredSoftkeyDeliveryBase>>;

  beforeAll(async () => {
    anchoredBase = await buildAnchoredSoftkeyDeliveryBase();
  });

  it('verifies anchored softkey delivery proofs and persists replay state after decrypt', async () => {
    const prepared = await prepareAnchoredSoftkeyDelivery({ base: anchoredBase });

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'password' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: prepared.deliveryAuth.meta.version,
        deliveredAt: NOW,
        deliveryAuth: prepared.deliveryAuth,
      } satisfies DecryptFetchResponse,
    });

    const decryptResult = await prepared.orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(decryptResult.ok).toBe(true);
    if (!decryptResult.ok) return;
    expect(decryptResult.data.plaintext).toBe('anchored softkey plaintext');
    await expect(prepared.receiverKeyStorage.load(VALID_UUID)).resolves.toMatchObject({
      senderAuthFpr: prepared.senderAuthFpr,
      lastAcceptedDelivery: {
        version: prepared.deliveryAuth.meta.version,
        ciphertextHash: prepared.cipherBundle.ciphertextHash,
      },
    });
  });

  it('returns INTEGRITY_MISMATCH when anchored decrypt payload is missing deliveryAuth', async () => {
    const prepared = await prepareAnchoredSoftkeyDelivery({ base: anchoredBase });

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'password' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: prepared.deliveryAuth.meta.version,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });

    const result = await prepared.orchestrator.decryptDelivered({
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

  it('returns INTEGRITY_MISMATCH when deliveryAuth exists but the local sender pin is missing', async () => {
    const prepared = await prepareAnchoredSoftkeyDelivery({ base: anchoredBase });
    const savedEnvelope = (await prepared.receiverKeyStorage.load(
      VALID_UUID
    )) as ReceiverKeyEnvelope;
    const { senderAuthFpr: _senderAuthFpr, ...legacyEnvelope } = savedEnvelope;
    await prepared.receiverKeyStorage.save({
      ...legacyEnvelope,
    });

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'password' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: prepared.deliveryAuth.meta.version,
        deliveredAt: NOW,
        deliveryAuth: prepared.deliveryAuth,
      } satisfies DecryptFetchResponse,
    });

    const result = await prepared.orchestrator.decryptDelivered({
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

  it('returns INTEGRITY_MISMATCH when anchored decrypt payload signer fingerprint mismatches', async () => {
    const prepared = await prepareAnchoredSoftkeyDelivery({ base: anchoredBase });
    const alternateKeyPair = await generateSoftkeyPair();
    const alternateSoftkeyPubJwk = await exportSoftkeyPublicJwk(alternateKeyPair.publicKey);

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'password' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: prepared.deliveryAuth.meta.version,
        deliveredAt: NOW,
        deliveryAuth: {
          ...prepared.deliveryAuth,
          signer: {
            softkeyPubJwk: alternateSoftkeyPubJwk,
          },
        },
      } satisfies DecryptFetchResponse,
    });

    const result = await prepared.orchestrator.decryptDelivered({
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

  it('returns INTEGRITY_MISMATCH when anchored decrypt payload proof is invalid', async () => {
    const prepared = await prepareAnchoredSoftkeyDelivery({ base: anchoredBase });
    const invalidSoftkeySignature = HexStringSchema.parse(
      `${prepared.deliveryAuth.proof.softkeySignature[0] === 'f' ? 'e' : 'f'}${prepared.deliveryAuth.proof.softkeySignature.slice(1)}`
    );

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'password' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: prepared.deliveryAuth.meta.version,
        deliveredAt: NOW,
        deliveryAuth: {
          ...prepared.deliveryAuth,
          proof: {
            softkeySignature: invalidSoftkeySignature,
          },
        },
      } satisfies DecryptFetchResponse,
    });

    const result = await prepared.orchestrator.decryptDelivered({
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

  it('returns INTEGRITY_MISMATCH when anchored decrypt payload version rolls back', async () => {
    const prepared = await prepareAnchoredSoftkeyDelivery({ base: anchoredBase });
    const savedEnvelope = (await prepared.receiverKeyStorage.load(
      VALID_UUID
    )) as ReceiverKeyEnvelope;
    await prepared.receiverKeyStorage.save({
      ...savedEnvelope,
      lastAcceptedDelivery: {
        version: prepared.deliveryAuth.meta.version + 1,
        ciphertextHash: prepared.cipherBundle.ciphertextHash,
        acceptedAt: Number(NOW) - 1,
      },
    });

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'password' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: prepared.deliveryAuth.meta.version,
        deliveredAt: NOW,
        deliveryAuth: prepared.deliveryAuth,
      } satisfies DecryptFetchResponse,
    });

    const result = await prepared.orchestrator.decryptDelivered({
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

  it('returns INTEGRITY_MISMATCH when anchored decrypt payload reuses a version with a different hash', async () => {
    const prepared = await prepareAnchoredSoftkeyDelivery({ base: anchoredBase });
    const savedEnvelope = (await prepared.receiverKeyStorage.load(
      VALID_UUID
    )) as ReceiverKeyEnvelope;
    await prepared.receiverKeyStorage.save({
      ...savedEnvelope,
      lastAcceptedDelivery: {
        version: prepared.deliveryAuth.meta.version,
        ciphertextHash: HexStringSchema.parse(
          'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        ),
        acceptedAt: Number(NOW) - 1,
      },
    });

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'password' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: prepared.deliveryAuth.meta.version,
        deliveredAt: NOW,
        deliveryAuth: prepared.deliveryAuth,
      } satisfies DecryptFetchResponse,
    });

    const result = await prepared.orchestrator.decryptDelivered({
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

  it('returns KEY_STORAGE_ERROR when replay-state persistence fails after anchored decrypt', async () => {
    const backingStorage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-persist-failure',
      storeName: 'receiver-keys',
    });
    const receiverKeyStorage = {
      load: vi.fn((uuid: string) => backingStorage.load(uuid)),
      remove: vi.fn((uuid: string) => backingStorage.remove(uuid)),
      save: vi.fn(async (envelope: ReceiverKeyEnvelope) => {
        if (envelope.lastAcceptedDelivery) {
          throw Object.assign(new Error('persist failed'), { code: 'KEY_STORAGE_ERROR' });
        }
        return backingStorage.save(envelope);
      }),
    };
    const prepared = await prepareAnchoredSoftkeyDelivery({
      base: anchoredBase,
      receiverKeyStorage,
    });

    vi.mocked(prepared.apiClient.publicStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        state: CHANNEL_STATE.DELIVERED,
        adminMode: 'password' as const,
        securityProfile: SECURITY_PROFILE.STANDARD,
      },
    });
    vi.mocked(prepared.apiClient.decryptFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        cipherBundle: prepared.cipherBundle,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: prepared.deliveryAuth.meta.version,
        deliveredAt: NOW,
        deliveryAuth: prepared.deliveryAuth,
      } satisfies DecryptFetchResponse,
    });

    const result = await prepared.orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'KEY_STORAGE_ERROR',
        stage: 'decrypt.persist-state',
      },
    });
    expect(useDecryptStore.getState().plaintext).toBeNull();
  });
});
