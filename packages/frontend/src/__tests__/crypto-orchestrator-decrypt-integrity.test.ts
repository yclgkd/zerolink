// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import {
  type AssertionJSON,
  Base64UrlSchema,
  CHANNEL_STATE,
  type DecryptFetchResponse,
  HexStringSchema,
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

import { createIndexedDbReceiverKeyStorage } from '../crypto/storage';
import { assertWithWebAuthn, type WebAuthnAdapterResult } from '../crypto/webauthn';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import {
  buildExpectedCipherAad,
  CHALLENGE_EXPIRES_AT,
  createOrchestrator,
  NOW,
  toMutableReceiverJwk,
  VALID_ASSERTION,
  VALID_B64U,
  VALID_HEX,
  VALID_LOCK_SECRET,
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

describe('crypto orchestrator – decryptDelivered (integrity checks)', () => {
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
      profile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
      profile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
      profile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
