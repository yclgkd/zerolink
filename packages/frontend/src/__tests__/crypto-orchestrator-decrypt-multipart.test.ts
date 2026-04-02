// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import {
  type AssertionJSON,
  CHANNEL_STATE,
  type DecryptFetchResponse,
  type HexString,
  HexStringSchema,
  type MultipartFileRef,
  MultipartFileRefSchema,
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
  CHALLENGE_EXPIRES_AT,
  createOrchestrator,
  NOW,
  toMutableReceiverJwk,
  VALID_ALLOW_CREDENTIALS,
  VALID_ASSERTION,
  VALID_B64U,
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
  vi.unstubAllGlobals();
});

async function prepareMultipartDeliveryFixture(): Promise<{
  orchestrator: ReturnType<typeof createOrchestrator>['orchestrator'];
  apiClient: ReturnType<typeof createOrchestrator>['apiClient'];
  fileRef: MultipartFileRef;
  receiverPubFpr: HexString;
  downloadBodies: Map<string, Uint8Array>;
}> {
  const storage = createIndexedDbReceiverKeyStorage({
    dbName: `test-orchestrator-decrypt-multipart-${Math.random().toString(16).slice(2)}`,
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
  if (!lockResult.ok) {
    throw new Error('expected lock to succeed');
  }
  const receiverPubFpr = HexStringSchema.parse(lockResult.data.receiverPubFpr);

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
  vi.mocked(apiClient.filePolicy).mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      ok: true,
      policy: {
        maxFileBytes: 1_048_576,
        multipartThresholdBytes: 1,
        chunkSizeBytes: 16,
        maxChunks: 16,
        multipartSupported: true,
      },
    },
  });

  const uploadedCiphertextByIndex = new Map<number, Uint8Array>();
  vi.mocked(apiClient.fileUploadInitiate).mockImplementation(async (input) => ({
    ok: true,
    status: 200,
    data: {
      ok: true,
      uploadId: VALID_B64U,
      chunks: Array.from({ length: input.chunkCount }, (_unused, index) => ({
        index,
        uploadUrl: `https://upload.test/${index}`,
      })),
    },
  }));
  vi.mocked(apiClient.fileUploadChunk).mockImplementation(async (uploadUrl, body) => {
    const index = Number(uploadUrl.split('/').at(-1));
    uploadedCiphertextByIndex.set(index, Uint8Array.from(body));
    return {
      ok: true,
      status: 200,
      data: {
        etag: `etag-${index}`,
      },
    };
  });

  let deliveredFileRef: MultipartFileRef | null = null;
  vi.mocked(apiClient.fileUploadComplete).mockImplementation(async (input) => {
    const fileRef = MultipartFileRefSchema.parse({
      storageBackend: 'minio',
      chunkSizeBytes: input.chunkSizeBytes,
      chunkCount: input.chunks.length,
      totalPlaintextBytes: input.totalPlaintextBytes,
      totalCiphertextBytes: input.totalCiphertextBytes,
      baseIv: input.baseIv,
      encContentKey: input.encContentKey,
      chunks: input.chunks.map((chunk) => ({
        index: chunk.index,
        storageKey: `files/${input.uploadId}/${String(chunk.index).padStart(4, '0')}.bin`,
        ciphertextBytes: chunk.ciphertextBytes,
        ciphertextHash: chunk.ciphertextHash,
      })),
    });

    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        fileRef,
      },
    };
  });
  vi.mocked(apiClient.compoundCommit).mockImplementation(async (input) => {
    if (input.intent.op === 'update' && input.intent.fileRef) {
      deliveredFileRef = MultipartFileRefSchema.parse(input.intent.fileRef);
    }
    return { ok: true, status: 200, data: { ok: true } };
  });

  const deliverResult = await orchestrator.deliverSecret({
    uuid: VALID_UUID,
    profile: SECURITY_PROFILE.SECURE,
    plaintext: '',
    file: {
      fileName: 'secret.bin',
      mediaType: 'application/octet-stream',
      bytes: Uint8Array.from([1, 2, 3, 4, 5]),
    },
  });
  if (!deliverResult.ok) {
    throw new Error(JSON.stringify(deliverResult.error));
  }
  const fileRef = deliveredFileRef;
  expect(fileRef).not.toBeNull();
  if (!fileRef) {
    throw new Error('expected multipart fileRef');
  }
  const resolvedFileRef: MultipartFileRef = fileRef;

  const downloadBodies = new Map<string, Uint8Array>();
  for (const chunk of resolvedFileRef.chunks) {
    const ciphertext = uploadedCiphertextByIndex.get(chunk.index);
    if (!ciphertext) {
      throw new Error(`missing uploaded ciphertext for chunk ${chunk.index}`);
    }
    downloadBodies.set(`https://download.test/${chunk.index}`, Uint8Array.from(ciphertext));
  }

  return {
    orchestrator,
    apiClient,
    fileRef: resolvedFileRef,
    receiverPubFpr,
    downloadBodies,
  };
}

describe('crypto orchestrator – decryptDelivered (multipart)', () => {
  it('downloads multipart chunks through apiClient.fileDownloadChunk instead of raw fetch', async () => {
    const prepared = await prepareMultipartDeliveryFixture();
    const rawFetch = vi.fn(async () => {
      throw new Error('unexpected raw fetch');
    });
    vi.stubGlobal('fetch', rawFetch);

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
        fileRef: prepared.fileRef,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: 0,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });
    vi.mocked(prepared.apiClient.fileFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        chunks: prepared.fileRef.chunks.map((chunk) => ({
          index: chunk.index,
          downloadUrl: `https://download.test/${chunk.index}`,
        })),
      },
    });
    vi.mocked(prepared.apiClient.fileDownloadChunk).mockImplementation(async (downloadUrl) => {
      const body = prepared.downloadBodies.get(downloadUrl);
      if (!body) {
        return {
          ok: false,
          error: {
            ok: false,
            code: 'NOT_FOUND',
            status: 404,
          },
        };
      }
      return {
        ok: true,
        status: 200,
        data: Uint8Array.from(body),
      };
    });

    const decryptResult = await prepared.orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(decryptResult.ok).toBe(true);
    if (!decryptResult.ok) return;
    expect(decryptResult.data.payload).toEqual({
      kind: 'file',
      fileName: 'secret.bin',
      mediaType: 'application/octet-stream',
      size: 5,
      bytes: Uint8Array.from([1, 2, 3, 4, 5]),
    });
    expect(vi.mocked(prepared.apiClient.fileDownloadChunk)).toHaveBeenCalledTimes(
      prepared.fileRef.chunkCount
    );
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it('surfaces NETWORK_ERROR when multipart chunk download fails via the API client', async () => {
    const prepared = await prepareMultipartDeliveryFixture();

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
        fileRef: prepared.fileRef,
        receiverPubFpr: prepared.receiverPubFpr,
        cipherVersion: 0,
        deliveredAt: NOW,
      } satisfies DecryptFetchResponse,
    });
    vi.mocked(prepared.apiClient.fileFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        chunks: prepared.fileRef.chunks.map((chunk) => ({
          index: chunk.index,
          downloadUrl: `https://download.test/${chunk.index}`,
        })),
      },
    });
    vi.mocked(prepared.apiClient.fileDownloadChunk).mockResolvedValue({
      ok: false,
      error: {
        ok: false,
        code: 'NETWORK_ERROR',
        status: null,
      },
    });

    const decryptResult = await prepared.orchestrator.decryptDelivered({
      uuid: VALID_UUID,
      passphrase: 'Strong#Pass1234',
    });

    expect(decryptResult).toEqual({
      ok: false,
      error: {
        ok: false,
        code: 'NETWORK_ERROR',
        stage: 'decrypt.file-chunk.download',
      },
    });
  });
});
