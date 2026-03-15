// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import {
  AES_GCM,
  type AssertionJSON,
  Base64UrlSchema,
  CHANNEL_STATE,
  type DecryptFetchResponse,
  HexStringSchema,
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
import { exportSoftkeyPublicJwk, generateSoftkeyPair } from '../crypto/softkey';
import { createIndexedDbReceiverKeyStorage, type ReceiverKeyEnvelope } from '../crypto/storage';
import { assertWithWebAuthn, type WebAuthnAdapterResult } from '../crypto/webauthn';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import {
  buildExpectedCipherAad,
  CHALLENGE_EXPIRES_AT,
  computeReceiverPubFpr,
  createDeferred,
  createOrchestrator,
  NEXT_UUID_BRANDED,
  NOW,
  prepareAnchoredSoftkeyDelivery,
  toMutableReceiverJwk,
  VALID_ASSERTION,
  VALID_B64U,
  VALID_HEX,
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

describe('crypto orchestrator – decryptDelivered', () => {
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
    expect('plaintextBytes' in decryptResult.data).toBe(false);
    expect(useDecryptStore.getState().plaintext).toBe('receiver can decrypt this');
  });

  it('verifies anchored softkey delivery proofs and persists replay state after decrypt', async () => {
    const prepared = await prepareAnchoredSoftkeyDelivery();

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
    const prepared = await prepareAnchoredSoftkeyDelivery();

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
    const prepared = await prepareAnchoredSoftkeyDelivery();
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
    const prepared = await prepareAnchoredSoftkeyDelivery();
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
    const prepared = await prepareAnchoredSoftkeyDelivery();
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
    const prepared = await prepareAnchoredSoftkeyDelivery();
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
    const prepared = await prepareAnchoredSoftkeyDelivery();
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
          aad: buildExpectedCipherAad(VALID_UUID, 0, VALID_HEX),
          encContentKey: VALID_B64U,
          ciphertextHash: HexStringSchema.parse(
            'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
          ),
          padBlock: 4096,
        },
        receiverPubFpr: VALID_HEX,
        cipherVersion: 0,
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

  it('returns INTEGRITY_MISMATCH when decrypt payload receiver fingerprint mismatches local key', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-receiver-mismatch',
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
      plaintext: 'fingerprint mismatch payload',
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
        cipherBundle: committedCipherBundle,
        receiverPubFpr: HexStringSchema.parse(
          'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        ),
        cipherVersion: 0,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
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

  it('returns INTEGRITY_MISMATCH when decrypt payload aad does not match uuid/version/fingerprint', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-aad-mismatch',
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
      plaintext: 'aad mismatch payload',
    });
    expect(deliverResult.ok).toBe(true);
    expect(committedCipherBundle).not.toBeNull();
    if (!committedCipherBundle) return;
    const deliveredCipherBundle = committedCipherBundle as DecryptFetchResponse['cipherBundle'];

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
          ...deliveredCipherBundle,
          aad: Base64UrlSchema.parse('dGFtcGVyZWQtYWFk'),
        },
        receiverPubFpr: lockResult.data.receiverPubFpr,
        cipherVersion: 0,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
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

  it('returns INTEGRITY_MISMATCH when a legacy decrypt payload rolls back below the stored version', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-orchestrator-decrypt-legacy-rollback',
      storeName: 'receiver-keys',
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
      lastAcceptedDelivery: {
        version: 1,
        ciphertextHash: HexStringSchema.parse(
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        ),
        acceptedAt: Number(NOW) - 1,
      },
      updatedAt: Number(NOW),
    });
    const { orchestrator, apiClient } = createOrchestrator({
      receiverKeyStorage: storage,
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
          aad: buildExpectedCipherAad(VALID_UUID, 0, VALID_HEX),
          encContentKey: VALID_B64U,
          ciphertextHash: HexStringSchema.parse(
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
          ),
          padBlock: 4096,
        },
        receiverPubFpr: VALID_HEX,
        cipherVersion: 0,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
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
        cipherVersion: 0,
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
