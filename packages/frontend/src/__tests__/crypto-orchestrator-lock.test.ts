// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import type { LockBeginResponse } from '@zerolink/shared';
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
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import {
  CHALLENGE_EXPIRES_AT,
  createOrchestrator,
  VALID_B64U,
  VALID_LOCK_SECRET,
  VALID_SENDER_AUTH_FPR,
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

describe('crypto orchestrator – lockChannel', () => {
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
      senderAuthFpr: VALID_SENDER_AUTH_FPR,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const savedEnvelope = await storage.load(VALID_UUID);
    expect(savedEnvelope).not.toBeNull();
    expect(savedEnvelope?.receiverPubFpr).toBe(result.data.receiverPubFpr);
    expect(savedEnvelope?.senderAuthFpr).toBe(VALID_SENDER_AUTH_FPR);
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
});
