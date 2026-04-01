// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import {
  AES_GCM,
  type AssertionJSON,
  CHANNEL_STATE,
  deriveUpdateProofChallengeB64u,
  MAX_PLAINTEXT_BYTES,
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
import { assertWithWebAuthn, type WebAuthnAdapterResult } from '../crypto/webauthn';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import {
  CHALLENGE_EXPIRES_AT,
  computeReceiverPubFpr,
  createDeferred,
  createOrchestrator,
  deliverAndCaptureCipherBundle,
  NEXT_UUID_BRANDED,
  toMutableReceiverJwk,
  VALID_ALLOW_CREDENTIALS,
  VALID_ASSERTION,
  VALID_B64U,
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

describe('crypto orchestrator – deliverSecret and deleteChannel', () => {
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
      profile: SECURITY_PROFILE.SECURE,
      plaintext: 'hello from sender',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.intent.op).toBe('update');
    expect(result.data.intentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(useDeliverStore.getState().channelState).toBe(CHANNEL_STATE.DELIVERED);
    expect(vi.mocked(assertWithWebAuthn)).toHaveBeenCalledWith({
      profile: SECURITY_PROFILE.SECURE,
      requestOptions: {
        publicKey: expect.objectContaining({
          allowCredentials: VALID_ALLOW_CREDENTIALS,
          challenge: await deriveUpdateProofChallengeB64u({
            uuid: VALID_UUID_BRANDED,
            intentHash: result.data.intentHash,
          }),
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
      profile: SECURITY_PROFILE.SECURE,
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
      profile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
        adminMode: 'webauthn',
      },
    });

    const result = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
        adminMode: 'webauthn',
      },
    });

    const result = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.SECURE,
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

  it('delivers file payloads using the deployment file policy', async () => {
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
        securityProfile: SECURITY_PROFILE.SECURE,
        adminMode: 'webauthn',
      },
    });
    vi.mocked(apiClient.filePolicy).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        policy: {
          maxFileBytes: MAX_PLAINTEXT_BYTES,
          multipartThresholdBytes: MAX_PLAINTEXT_BYTES,
          chunkSizeBytes: 262_144,
          maxChunks: 8,
          multipartSupported: false,
        },
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
      profile: SECURITY_PROFILE.SECURE,
      plaintext: '',
      file: {
        fileName: 'secret.bin',
        mediaType: 'application/octet-stream',
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.payloadKind).toBe('file');
    expect(vi.mocked(apiClient.filePolicy)).toHaveBeenCalledTimes(1);
    expect(useDeliverStore.getState().channelState).toBe(CHANNEL_STATE.DELIVERED);
  });

  it('returns MULTIPART_REQUIRED when file exceeds the inline threshold', async () => {
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
        securityProfile: SECURITY_PROFILE.SECURE,
        adminMode: 'webauthn',
      },
    });
    vi.mocked(apiClient.filePolicy).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        policy: {
          maxFileBytes: MAX_PLAINTEXT_BYTES,
          multipartThresholdBytes: 4,
          chunkSizeBytes: 262_144,
          maxChunks: 8,
          multipartSupported: false,
        },
      },
    });

    const result = await orchestrator.deliverSecret({
      uuid: VALID_UUID,
      profile: SECURITY_PROFILE.SECURE,
      plaintext: '',
      file: {
        fileName: 'secret.bin',
        mediaType: 'application/octet-stream',
        bytes: new Uint8Array([1, 2, 3, 4, 5]),
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'MULTIPART_REQUIRED',
        stage: 'deliver.file-policy',
        message: 'Selected file exceeds the inline delivery limit for this deployment.',
      },
    });
    expect(vi.mocked(assertWithWebAuthn)).not.toHaveBeenCalled();
    expect(vi.mocked(apiClient.compoundCommit)).not.toHaveBeenCalled();
  });

  it('uses 4 KB padding for quick profile delivery', async () => {
    const cipherBundle = await deliverAndCaptureCipherBundle(SECURITY_PROFILE.QUICK);

    expect(cipherBundle.padBlock).toBe(AES_GCM.PAD_BLOCK_DEFAULT);
  });

  it('uses 8 KB padding for secure profile delivery', async () => {
    const cipherBundle = await deliverAndCaptureCipherBundle(SECURITY_PROFILE.SECURE);

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
        securityProfile: SECURITY_PROFILE.SECURE,
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
      profile: SECURITY_PROFILE.SECURE,
    });

    expect(result.ok).toBe(true);
    expect(useDeliverStore.getState().channelState).toBe(CHANNEL_STATE.DELETED);
    expect(vi.mocked(assertWithWebAuthn)).toHaveBeenCalledWith({
      profile: SECURITY_PROFILE.SECURE,
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
      profile: SECURITY_PROFILE.SECURE,
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
        securityProfile: SECURITY_PROFILE.SECURE,
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
});
