import {
  type AssertionJSON,
  type AttestationJSON,
  type Base64Url,
  Base64UrlSchema,
  buildCipherBundleAadBytes,
  type DecryptedSharePayload,
  type DecryptFetchResponse,
  type DecryptFetchSoftkeyDeliveryAuth,
  type ECDSAPublicKeyJWK,
  type HexString,
  HexStringSchema,
  type RSAPublicKeyJWK,
  SECURITY_PROFILE,
  type SecurityProfile,
  UnixMsSchema,
  type UpdateIntent,
  UUIDSchema,
} from '@zerolink/shared';
import { exportReceiverPublicKeyToJwk, generateReceiverKeyPair } from '@zerolink/shared/crypto/rsa';
import { expect, vi } from 'vitest';

import type { ApiClient } from '../../api/client';
import {
  type CryptoOrchestrator,
  type CryptoOrchestratorDeps,
  createCryptoOrchestrator,
} from '../../crypto/orchestrator';
import {
  createIndexedDbReceiverKeyStorage,
  type ReceiverKeyEnvelope,
  type ReceiverKeyStorage,
} from '../../crypto/storage';
import { assertWithWebAuthn, type WebAuthnAdapterResult } from '../../crypto/webauthn';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../../stores';
import { FAST_TEST_ARGON2ID_KDF_PARAMS } from './crypto-test-params';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
export const VALID_HEX = HexStringSchema.parse(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);
export const VALID_B64U = Base64UrlSchema.parse('bW9ja19iYXNlNjR1cmw');
export const VALID_LOCK_SECRET = Base64UrlSchema.parse(
  'bW9ja19sb2NrX3NlY3JldF8xMjM0NTY3ODkwMTIzNDU'
);
export const NOW = UnixMsSchema.parse(1_700_000_000_000);
export const CHALLENGE_EXPIRES_AT = UnixMsSchema.parse(Number(NOW) + 60_000);
export const VALID_UUID_BRANDED = UUIDSchema.parse(VALID_UUID);
export const NEXT_UUID_BRANDED = UUIDSchema.parse('bbbbbbbbbbbbbbbbbbbbb');
export const VALID_SENDER_AUTH_FPR = HexStringSchema.parse(
  '7568ef3cbdb5a90f89bc6ecdd08f7ba7730d943ca80d8756f44991bf34624eb5'
);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

export const VALID_ATTESTATION: AttestationJSON = {
  id: VALID_B64U,
  rawId: VALID_B64U,
  type: 'public-key',
  response: {
    clientDataJSON:
      'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiYlc5amExOWlZWE5sTmpSMWNtdyIsIm9yaWdpbiI6Imh0dHA6Ly9sb2NhbGhvc3QiLCJjcm9zc09yaWdpbiI6ZmFsc2V9' as Base64Url,
    attestationObject:
      'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViUSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NBAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAECAwQFBgcICQoLDA0ODxClAQIDJiABIVggwN2WqXica_0qtqGeuM8kDWKc7iQHUv5al40k5wQaXbYiWCBFdcj8lLRlDMuel7RsWomcebixZmqAGjntoJMCcIPtKg' as Base64Url,
    transports: ['internal'],
  },
};

export const VALID_ASSERTION: AssertionJSON = {
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

export const VALID_ALLOW_CREDENTIALS = [{ id: VALID_B64U, type: 'public-key' as const }];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

export function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function buildExpectedCipherAad(
  uuid: string,
  version: number,
  receiverPubFpr: HexString
): Base64Url {
  return Base64UrlSchema.parse(
    encodeBase64Url(
      buildCipherBundleAadBytes({
        uuid: UUIDSchema.parse(uuid),
        version,
        receiverPubFpr,
      })
    )
  );
}

export function toMutableReceiverJwk(jwk: RSAPublicKeyJWK): {
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

export async function computeReceiverPubFpr(publicKey: CryptoKey): Promise<HexString> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
  const digest = await crypto.subtle.digest('SHA-256', spki);
  return HexStringSchema.parse(
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  );
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

interface CreateOrchestratorTestOptions {
  useFastKdf?: boolean | undefined;
}

function cloneCipherBundle(
  cipherBundle: DecryptFetchResponse['cipherBundle']
): DecryptFetchResponse['cipherBundle'] {
  return {
    ...cipherBundle,
  };
}

function cloneDeliveryAuth(
  deliveryAuth: DecryptFetchSoftkeyDeliveryAuth
): DecryptFetchSoftkeyDeliveryAuth {
  return {
    ...deliveryAuth,
    meta: {
      ...deliveryAuth.meta,
    },
    signer: {
      ...deliveryAuth.signer,
    },
    proof: {
      ...deliveryAuth.proof,
    },
  };
}

function cloneWrappedPrivateKey(
  wrappedPrivateKey: ReceiverKeyEnvelope['wrappedPrivateKey']
): ReceiverKeyEnvelope['wrappedPrivateKey'] {
  return {
    ...wrappedPrivateKey,
    kdf: {
      ...wrappedPrivateKey.kdf,
    },
  };
}

export function cloneReceiverKeyEnvelope(envelope: ReceiverKeyEnvelope): ReceiverKeyEnvelope {
  return {
    ...envelope,
    wrappedPrivateKey: cloneWrappedPrivateKey(envelope.wrappedPrivateKey),
    ...(envelope.lastAcceptedDelivery
      ? {
          lastAcceptedDelivery: {
            ...envelope.lastAcceptedDelivery,
          },
        }
      : {}),
  };
}

export function createApiClientMock(): ApiClient {
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
    filePolicy: vi.fn(),
  };
}

export function createOrchestrator(
  overrides: Partial<CryptoOrchestratorDeps> = {},
  options: CreateOrchestratorTestOptions = {}
): {
  orchestrator: CryptoOrchestrator;
  apiClient: ApiClient;
} {
  const apiClient = overrides.apiClient ?? createApiClientMock();
  const useFastKdf = options.useFastKdf ?? true;

  const orchestrator = createCryptoOrchestrator({
    apiClient,
    receiverKeyStorage:
      overrides.receiverKeyStorage ??
      createIndexedDbReceiverKeyStorage({
        dbName: `test-orchestrator-db-${Math.random().toString(16).slice(2)}`,
        storeName: 'receiver-keys',
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
    kdfParams: overrides.kdfParams ?? (useFastKdf ? FAST_TEST_ARGON2ID_KDF_PARAMS : undefined),
  });

  return { orchestrator, apiClient };
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

export function extractSenderAuthFprFromShareUrl(shareUrlWithFragment: string): HexString {
  const url = new URL(shareUrlWithFragment, 'https://zerolink.test');
  const senderAuthFpr = new URLSearchParams(url.hash.slice(1)).get('af');
  if (!senderAuthFpr) {
    throw new Error('missing sender auth fingerprint');
  }
  return HexStringSchema.parse(senderAuthFpr);
}

// ---------------------------------------------------------------------------
// Async scenario helpers
// ---------------------------------------------------------------------------

export interface DeliveredDecryptFixtureBase {
  cipherBundle: DecryptFetchResponse['cipherBundle'];
  receiverPubFpr: HexString;
  receiverKeyEnvelope: ReceiverKeyEnvelope;
  plaintext: string | null;
  expectedPayload: DecryptedSharePayload;
}

export async function buildDeliveredDecryptFixtureBase(
  params: {
    plaintext?: string;
    file?: {
      fileName: string;
      mediaType: string;
      bytes: Uint8Array;
    };
    receiverKeyStorage?: ReceiverKeyStorage | undefined;
    useFastKdf?: boolean | undefined;
  } = {}
): Promise<DeliveredDecryptFixtureBase> {
  const receiverKeyStorage =
    params.receiverKeyStorage ??
    createIndexedDbReceiverKeyStorage({
      dbName: `test-orchestrator-decrypt-base-${Math.random().toString(16).slice(2)}`,
      storeName: 'receiver-keys',
    });
  const { orchestrator, apiClient } = createOrchestrator(
    {
      receiverKeyStorage,
    },
    {
      useFastKdf: params.useFastKdf,
    }
  );
  const plaintext = params.plaintext ?? 'receiver can decrypt this';
  const expectedPayload: DecryptedSharePayload = params.file
    ? {
        kind: 'file',
        fileName: params.file.fileName,
        mediaType: params.file.mediaType,
        size: params.file.bytes.byteLength,
        bytes: Uint8Array.from(params.file.bytes),
      }
    : {
        kind: 'text',
        text: plaintext,
      };

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
  vi.mocked(apiClient.filePolicy).mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      ok: true,
      policy: {
        maxFileBytes: 2_097_152,
        multipartThresholdBytes: 2_097_152,
        chunkSizeBytes: 262_144,
        maxChunks: 8,
        multipartSupported: false,
      },
    },
  });

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
    plaintext: params.file ? '' : plaintext,
    ...(params.file ? { file: params.file } : {}),
  });
  expect(deliverResult.ok).toBe(true);
  expect(committedCipherBundle).not.toBeNull();
  if (!committedCipherBundle) {
    throw new Error('expected committed cipher bundle');
  }

  const receiverKeyEnvelope = await receiverKeyStorage.load(VALID_UUID);
  expect(receiverKeyEnvelope).not.toBeNull();
  if (!receiverKeyEnvelope) {
    throw new Error('expected receiver key envelope');
  }

  return {
    cipherBundle: cloneCipherBundle(committedCipherBundle),
    receiverPubFpr: lockResult.data.receiverPubFpr,
    receiverKeyEnvelope: cloneReceiverKeyEnvelope(receiverKeyEnvelope),
    plaintext: params.file ? null : plaintext,
    expectedPayload,
  };
}

export async function seedDeliveredDecryptFixture(
  base: DeliveredDecryptFixtureBase,
  params: {
    receiverKeyStorage?: ReceiverKeyStorage | undefined;
    useFastKdf?: boolean | undefined;
  } = {}
): Promise<{
  apiClient: ApiClient;
  orchestrator: CryptoOrchestrator;
  receiverKeyStorage: ReceiverKeyStorage;
  cipherBundle: DecryptFetchResponse['cipherBundle'];
  receiverPubFpr: HexString;
  plaintext: string | null;
  expectedPayload: DecryptedSharePayload;
}> {
  const receiverKeyStorage =
    params.receiverKeyStorage ??
    createIndexedDbReceiverKeyStorage({
      dbName: `test-orchestrator-decrypt-seeded-${Math.random().toString(16).slice(2)}`,
      storeName: 'receiver-keys',
    });
  await receiverKeyStorage.save(cloneReceiverKeyEnvelope(base.receiverKeyEnvelope));
  const { orchestrator, apiClient } = createOrchestrator(
    {
      receiverKeyStorage,
    },
    {
      useFastKdf: params.useFastKdf,
    }
  );

  return {
    apiClient,
    orchestrator,
    receiverKeyStorage,
    cipherBundle: cloneCipherBundle(base.cipherBundle),
    receiverPubFpr: base.receiverPubFpr,
    plaintext: base.plaintext,
    expectedPayload:
      base.expectedPayload.kind === 'file'
        ? {
            ...base.expectedPayload,
            bytes: Uint8Array.from(base.expectedPayload.bytes),
          }
        : base.expectedPayload,
  };
}

export interface AnchoredSoftkeyDeliveryBase {
  cipherBundle: DecryptFetchResponse['cipherBundle'];
  deliveryAuth: DecryptFetchSoftkeyDeliveryAuth;
  receiverPubFpr: HexString;
  receiverKeyEnvelope: ReceiverKeyEnvelope;
  senderAuthFpr: HexString;
}

export async function buildAnchoredSoftkeyDeliveryBase(
  params: {
    receiverKeyStorage?: ReceiverKeyStorage | undefined;
    uuid?: string;
    plaintext?: string | Uint8Array;
    file?:
      | {
          fileName: string;
          mediaType: string;
          bytes: Uint8Array;
        }
      | undefined;
    passphrase?: string;
    useFastKdf?: boolean | undefined;
  } = {}
): Promise<AnchoredSoftkeyDeliveryBase> {
  const receiverKeyStorage =
    params.receiverKeyStorage ??
    createIndexedDbReceiverKeyStorage({
      dbName: `test-orchestrator-anchored-base-${Math.random().toString(16).slice(2)}`,
      storeName: 'receiver-keys',
    });
  const { orchestrator, apiClient } = createOrchestrator(
    {
      receiverKeyStorage,
    },
    {
      useFastKdf: params.useFastKdf,
    }
  );
  const uuid = params.uuid ?? VALID_UUID;
  const passphrase = params.passphrase ?? 'Compat#Pass123';

  vi.mocked(apiClient.createBegin).mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      ok: true,
      creationOptions: {},
    },
  });

  let capturedSoftkeyPubJwk: ECDSAPublicKeyJWK | null = null;
  vi.mocked(apiClient.createFinish).mockImplementation(async (input) => {
    if ('softkeyPubJwk' in input) {
      capturedSoftkeyPubJwk = input.softkeyPubJwk as ECDSAPublicKeyJWK;
    }
    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        shareUrl: `/s/${uuid}`,
        manageUrl: `/m/${uuid}`,
      },
    };
  });

  const createResult = await orchestrator.createChannel({
    uuid,
    profile: SECURITY_PROFILE.QUICK,
    useCompatibilityMode: true,
    softkeyPassphrase: passphrase,
  });
  expect(createResult.ok).toBe(true);
  if (!createResult.ok) {
    throw new Error('expected compatibility create to succeed');
  }

  const senderAuthFpr = extractSenderAuthFprFromShareUrl(createResult.data.shareUrlWithFragment);

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
    uuid,
    lockSecretB64u: createResult.data.lockSecretB64u,
    passphrase: 'Strong#Pass1234',
    senderAuthFpr,
  });
  expect(lockResult.ok).toBe(true);
  if (!lockResult.ok) {
    throw new Error('expected lock to succeed');
  }

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
      securityProfile: SECURITY_PROFILE.QUICK,
      adminMode: 'password',
    },
  });

  let committed: {
    intent: UpdateIntent;
    softkeySignature: HexString;
  } | null = null;
  vi.mocked(apiClient.compoundCommit).mockImplementation(async (input) => {
    if (input.intent.op === 'update' && 'softkeySignature' in input) {
      committed = {
        intent: input.intent as UpdateIntent,
        softkeySignature: input.softkeySignature as HexString,
      };
    }
    return { ok: true, status: 200, data: { ok: true } };
  });

  if (!createResult.data.wrappedPrivateKey) {
    throw new Error('expected wrappedPrivateKey in createResult');
  }
  if (params.file) {
    vi.mocked(apiClient.filePolicy).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true,
        policy: {
          maxFileBytes: 2_097_152,
          multipartThresholdBytes: 2_097_152,
          chunkSizeBytes: 262_144,
          maxChunks: 8,
          multipartSupported: false,
        },
      },
    });
  }
  const deliverResult = await orchestrator.deliverSecret({
    uuid,
    profile: SECURITY_PROFILE.QUICK,
    plaintext: params.file ? '' : (params.plaintext ?? 'anchored softkey plaintext'),
    softkeyPassphrase: passphrase,
    wrappedPrivateKey: createResult.data.wrappedPrivateKey,
    ...(params.file ? { file: params.file } : {}),
  });
  expect(deliverResult.ok).toBe(true);
  expect(committed).not.toBeNull();
  if (committed === null) {
    throw new Error('expected a captured softkey delivery intent');
  }
  const capturedCommit = committed as {
    intent: UpdateIntent;
    softkeySignature: HexString;
  };

  if (!capturedSoftkeyPubJwk) {
    throw new Error('missing captured softkey pub jwk');
  }

  const receiverKeyEnvelope = await receiverKeyStorage.load(uuid);
  expect(receiverKeyEnvelope).not.toBeNull();
  if (!receiverKeyEnvelope) {
    throw new Error('expected receiver key envelope');
  }

  return {
    cipherBundle: cloneCipherBundle(capturedCommit.intent.cipherBundle),
    deliveryAuth: cloneDeliveryAuth({
      adminMode: 'password',
      meta: {
        version: capturedCommit.intent.version,
        timestamp: capturedCommit.intent.timestamp,
        nonce: capturedCommit.intent.nonce,
        ...(capturedCommit.intent.payloadKind
          ? { payloadKind: capturedCommit.intent.payloadKind }
          : {}),
        expireAt: capturedCommit.intent.expireAt,
      },
      signer: {
        softkeyPubJwk: capturedSoftkeyPubJwk,
      },
      proof: {
        softkeySignature: capturedCommit.softkeySignature,
      },
    }),
    receiverPubFpr: lockResult.data.receiverPubFpr,
    senderAuthFpr,
    receiverKeyEnvelope: cloneReceiverKeyEnvelope(receiverKeyEnvelope),
  };
}

export async function prepareAnchoredSoftkeyDelivery(
  params: {
    base?: AnchoredSoftkeyDeliveryBase;
    receiverKeyStorage?: ReceiverKeyStorage | undefined;
    useFastKdf?: boolean | undefined;
  } = {}
): Promise<{
  apiClient: ApiClient;
  orchestrator: CryptoOrchestrator;
  receiverKeyStorage: ReceiverKeyStorage;
  cipherBundle: DecryptFetchResponse['cipherBundle'];
  deliveryAuth: DecryptFetchSoftkeyDeliveryAuth;
  receiverPubFpr: HexString;
  senderAuthFpr: HexString;
}> {
  const base =
    params.base ??
    (await buildAnchoredSoftkeyDeliveryBase({
      receiverKeyStorage: params.receiverKeyStorage,
      useFastKdf: params.useFastKdf,
    }));
  const receiverKeyStorage =
    params.receiverKeyStorage ??
    createIndexedDbReceiverKeyStorage({
      dbName: `test-orchestrator-anchored-seeded-${Math.random().toString(16).slice(2)}`,
      storeName: 'receiver-keys',
    });
  await receiverKeyStorage.save(cloneReceiverKeyEnvelope(base.receiverKeyEnvelope));
  const { orchestrator, apiClient } = createOrchestrator(
    {
      receiverKeyStorage,
    },
    {
      useFastKdf: params.useFastKdf,
    }
  );

  return {
    apiClient,
    orchestrator,
    receiverKeyStorage,
    cipherBundle: cloneCipherBundle(base.cipherBundle),
    deliveryAuth: cloneDeliveryAuth(base.deliveryAuth),
    receiverPubFpr: base.receiverPubFpr,
    senderAuthFpr: base.senderAuthFpr,
  };
}

export async function deliverAndCaptureCipherBundle(
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
