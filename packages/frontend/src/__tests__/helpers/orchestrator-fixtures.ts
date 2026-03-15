import {
  type AssertionJSON,
  type AttestationJSON,
  type Base64Url,
  Base64UrlSchema,
  buildCipherBundleAadBytes,
  type DecryptFetchResponse,
  type DecryptFetchSoftkeyDeliveryAuth,
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
  createIndexedDbPendingSoftkeyCleanupStorage,
  createIndexedDbReceiverKeyStorage,
  createIndexedDbSoftkeyAdminStorage,
  type ReceiverKeyStorage,
  type SoftkeyAdminEnvelope,
} from '../../crypto/storage';
import { assertWithWebAuthn, type WebAuthnAdapterResult } from '../../crypto/webauthn';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../../stores';

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

export function buildSoftkeyAdminEnvelope(createdAt: number): SoftkeyAdminEnvelope {
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

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

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
  };
}

export function createOrchestrator(overrides: Partial<CryptoOrchestratorDeps> = {}): {
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

export async function prepareAnchoredSoftkeyDelivery(
  params: {
    receiverKeyStorage?: ReceiverKeyStorage;
    uuid?: string;
    plaintext?: string;
    passphrase?: string;
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
  const receiverKeyStorage =
    params.receiverKeyStorage ??
    createIndexedDbReceiverKeyStorage({
      dbName: `test-orchestrator-anchored-${Math.random().toString(16).slice(2)}`,
      storeName: 'receiver-keys',
    });
  const softkeyAdminStorage = createIndexedDbSoftkeyAdminStorage({
    dbName: `test-orchestrator-anchored-softkey-${Math.random().toString(16).slice(2)}`,
    storeName: 'softkey-admin',
  });
  const { orchestrator, apiClient } = createOrchestrator({
    receiverKeyStorage,
    softkeyAdminStorage,
  });
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
  vi.mocked(apiClient.createFinish).mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      ok: true,
      shareUrl: `/s/${uuid}`,
      manageUrl: `/m/${uuid}`,
    },
  });

  const createResult = await orchestrator.createChannel({
    uuid,
    profile: SECURITY_PROFILE.STANDARD,
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
      securityProfile: SECURITY_PROFILE.STANDARD,
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

  const deliverResult = await orchestrator.deliverSecret({
    uuid,
    profile: SECURITY_PROFILE.STANDARD,
    plaintext: params.plaintext ?? 'anchored softkey plaintext',
    softkeyPassphrase: passphrase,
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

  const softkeyEnvelope = await softkeyAdminStorage.load(uuid);
  if (!softkeyEnvelope) {
    throw new Error('missing softkey admin envelope');
  }

  return {
    apiClient,
    orchestrator,
    receiverKeyStorage,
    cipherBundle: capturedCommit.intent.cipherBundle,
    deliveryAuth: {
      adminMode: 'password',
      meta: {
        version: capturedCommit.intent.version,
        timestamp: capturedCommit.intent.timestamp,
        nonce: capturedCommit.intent.nonce,
        expireAt: capturedCommit.intent.expireAt,
      },
      signer: {
        softkeyPubJwk: softkeyEnvelope.softkeyPubJwk,
      },
      proof: {
        softkeySignature: capturedCommit.softkeySignature,
      },
    },
    receiverPubFpr: lockResult.data.receiverPubFpr,
    senderAuthFpr,
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
