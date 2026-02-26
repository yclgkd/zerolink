import type { CredentialCreationOptionsJSON } from '@github/webauthn-json';
import {
  type AssertionJSON,
  type AttestationJSON,
  type Base64Url,
  type ChannelState,
  type CipherBundle,
  type CompoundBeginResponse,
  computeIntentHash,
  type DecryptFetchResponse,
  type DeleteIntent,
  type HexString,
  type LockBeginResponse,
  NONCE_BYTES,
  type RSAPublicKeyJWK,
  type SecurityProfile,
  type UnixMs,
  type UpdateIntent,
  type UUID,
} from '@zerolink/shared';
import { decryptAesGcm, encryptAesGcm, generateAesKey } from '@zerolink/shared/crypto/aes';
import { unwrapPrivateKey, wrapPrivateKey } from '@zerolink/shared/crypto/kdf';
import {
  exportReceiverPublicKeyToJwk,
  generateReceiverKeyPair,
  importReceiverPublicKeyFromJwk,
  unwrapContentKey,
  wrapContentKey,
} from '@zerolink/shared/crypto/rsa';

import { type ApiClient, apiClient as defaultApiClient } from '../api/client';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import {
  buildShareUrlWithFragment,
  computeSha256Hex,
  decodeBase64UrlBytes,
  deriveExpectedCompoundChallengeB64u,
  deriveLockKeyB64u,
  deriveLockProofHex,
  encodeBase64UrlBytes,
} from './protocol-utils';
import { deriveSafetyCodeDisplay } from './safety-code-derive';
import {
  createIndexedDbReceiverKeyStorage,
  type ReceiverKeyEnvelope,
  type ReceiverKeyStorage,
} from './storage';
import {
  assertWithWebAuthn,
  registerWithWebAuthn,
  type WebAuthnAdapterErrorCode,
} from './webauthn';

export type CryptoOrchestratorErrorCode =
  | 'API_ERROR'
  | 'WEBAUTHN_ERROR'
  | 'FALLBACK_REQUIRED'
  | 'PROFILE_BLOCKED'
  | 'INVALID_LOCK_SECRET'
  | 'MISSING_LOCK_CHALLENGE'
  | 'MISSING_RECEIVER_IDENTITY'
  | 'KEY_STORAGE_ERROR'
  | 'PASSPHRASE_REQUIRED'
  | 'CHANNEL_NOT_DELIVERED'
  | 'INTEGRITY_MISMATCH'
  | 'CRYPTO_ERROR'
  | 'INTERNAL_ERROR';

export interface CryptoOrchestratorError {
  ok: false;
  code: CryptoOrchestratorErrorCode | string;
  stage: string;
  message?: string;
}

export type CryptoOrchestratorResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: CryptoOrchestratorError;
    };

type CreateStore = typeof useCreateStore;
type LockStore = typeof useLockStore;
type DeliverStore = typeof useDeliverStore;
type DecryptStore = typeof useDecryptStore;

export interface CryptoOrchestratorDeps {
  apiClient?: ApiClient;
  receiverKeyStorage?: ReceiverKeyStorage;
  createStore?: CreateStore;
  lockStore?: LockStore;
  deliverStore?: DeliverStore;
  decryptStore?: DecryptStore;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
}

export interface CreateChannelInput {
  uuid: string;
  profile: SecurityProfile;
  lockSecretB64u?: string;
}

export interface CreateChannelOutput {
  shareUrl: string;
  manageUrl: string;
  shareUrlWithFragment: string;
  lockSecretB64u: string;
  lockKeyB64u: string;
}

export interface LockChannelInput {
  uuid: string;
  lockSecretB64u: string;
  passphrase: string;
}

export interface LockChannelOutput {
  receiverPubJwk: RSAPublicKeyJWK;
  receiverPubFpr: HexString;
}

export interface DeliverSecretInput {
  uuid: string;
  profile: SecurityProfile;
  plaintext: string | Uint8Array;
  expireAt?: number | null;
}

export interface DeliverSecretOutput {
  intentHash: string;
  intent: UpdateIntent;
  expectedChallenge: string;
  cipherBundle: CipherBundle;
}

export interface DeleteChannelInput {
  uuid: string;
  profile: SecurityProfile;
}

export interface DeleteChannelOutput {
  intentHash: string;
  intent: DeleteIntent;
  expectedChallenge: string;
}

export interface DecryptDeliveredInput {
  uuid: string;
  passphrase: string;
}

export interface DecryptDeliveredOutput {
  plaintext: string;
  plaintextBytes: Uint8Array;
  deliveredAt: number;
  receiverPubFpr: string;
}

export interface CryptoOrchestrator {
  createChannel: (
    input: CreateChannelInput
  ) => Promise<CryptoOrchestratorResult<CreateChannelOutput>>;
  lockChannel: (input: LockChannelInput) => Promise<CryptoOrchestratorResult<LockChannelOutput>>;
  deliverSecret: (
    input: DeliverSecretInput
  ) => Promise<CryptoOrchestratorResult<DeliverSecretOutput>>;
  deleteChannel: (
    input: DeleteChannelInput
  ) => Promise<CryptoOrchestratorResult<DeleteChannelOutput>>;
  decryptDelivered: (
    input: DecryptDeliveredInput
  ) => Promise<CryptoOrchestratorResult<DecryptDeliveredOutput>>;
}

const LOCK_SECRET_PATTERN = /^[A-Za-z0-9_-]+$/u;

function toError(code: CryptoOrchestratorErrorCode | string, stage: string, message?: string) {
  return {
    ok: false as const,
    error: {
      ok: false as const,
      code,
      stage,
      ...(message ? { message } : {}),
    },
  };
}

function mapWebAuthnError(
  code: WebAuthnAdapterErrorCode,
  stage: string
): CryptoOrchestratorResult<never> {
  if (code === 'FALLBACK_REQUIRED' || code === 'PROFILE_BLOCKED') {
    return toError(code, stage);
  }
  return toError('WEBAUTHN_ERROR', stage, code);
}

function ensurePassphrase(
  passphrase: string,
  stage: string
): CryptoOrchestratorResult<never> | null {
  if (passphrase.length > 0) return null;
  return toError('PASSPHRASE_REQUIRED', stage);
}

function toUtf8Bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function asUuid(value: string): UUID {
  return value as UUID;
}

function asUnixMs(value: number): UnixMs {
  return value as UnixMs;
}

async function computeReceiverPubFingerprint(publicKey: CryptoKey): Promise<HexString> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
  return (await computeSha256Hex(spki)) as HexString;
}

function parseLockSecret(lockSecretB64u: string): CryptoOrchestratorResult<never> | null {
  if (!LOCK_SECRET_PATTERN.test(lockSecretB64u)) {
    return toError('INVALID_LOCK_SECRET', 'lock.validate');
  }
  return null;
}

function toCipherBundleTransport(input: {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  aad: Uint8Array;
  encContentKey: Uint8Array;
  ciphertextHash: string;
  padBlock: number;
}): CipherBundle {
  return {
    ciphertext: encodeBase64UrlBytes(input.ciphertext),
    iv: encodeBase64UrlBytes(input.iv),
    aad: encodeBase64UrlBytes(input.aad),
    encContentKey: encodeBase64UrlBytes(input.encContentKey),
    ciphertextHash: input.ciphertextHash as HexString,
    padBlock: input.padBlock,
  };
}

function randomBase64Url(length: number, randomBytes: (length: number) => Uint8Array): Base64Url {
  return encodeBase64UrlBytes(randomBytes(length));
}

function toPlaintextBytes(value: string | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    return toUtf8Bytes(value);
  }
  return value;
}

function isDeliveredState(state: ChannelState): boolean {
  return state === 'delivered';
}

function toStorageErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'KEY_STORAGE_ERROR';
}

function toApiReceiverPubJwk(
  jwk: RSAPublicKeyJWK
): Parameters<ApiClient['lockCommit']>[0]['receiverPubJwk'] {
  return {
    ...jwk,
    key_ops: ['encrypt'],
  };
}

export function createCryptoOrchestrator(deps: CryptoOrchestratorDeps = {}): CryptoOrchestrator {
  const client = deps.apiClient ?? defaultApiClient;
  const receiverKeyStorage = deps.receiverKeyStorage ?? createIndexedDbReceiverKeyStorage();
  const createStore = deps.createStore ?? useCreateStore;
  const lockStore = deps.lockStore ?? useLockStore;
  const deliverStore = deps.deliverStore ?? useDeliverStore;
  const decryptStore = deps.decryptStore ?? useDecryptStore;
  const now = deps.now ?? (() => Date.now());
  const randomBytes =
    deps.randomBytes ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length)));

  async function createChannel(
    input: CreateChannelInput
  ): Promise<CryptoOrchestratorResult<CreateChannelOutput>> {
    const state = createStore.getState();
    state.startCreateBegin();

    const createBeginResult = await client.createBegin({
      uuid: input.uuid,
      timestamp: now(),
      securityProfile: input.profile,
    });
    if (!createBeginResult.ok) {
      state.failCreateBegin(createBeginResult.error.code);
      return toError(createBeginResult.error.code, 'create.begin');
    }

    state.completeCreateBegin(createBeginResult.data);
    const lockSecretB64u = input.lockSecretB64u ?? randomBase64Url(32, randomBytes);

    const registerResult = await registerWithWebAuthn({
      profile: input.profile,
      creationOptions: createBeginResult.data
        .creationOptions as unknown as CredentialCreationOptionsJSON,
    });
    if (!registerResult.ok) {
      state.failCreateFinish(registerResult.error.code);
      return mapWebAuthnError(registerResult.error.code, 'create.register');
    }

    let lockKeyB64u: Base64Url;
    try {
      lockKeyB64u = await deriveLockKeyB64u(input.uuid, lockSecretB64u);
    } catch (error) {
      return toError(
        'CRYPTO_ERROR',
        'create.lock-key',
        error instanceof Error ? error.message : undefined
      );
    }

    state.startCreateFinish();
    const createFinishResult = await client.createFinish({
      uuid: input.uuid,
      attestation: registerResult.data as AttestationJSON,
      lockKeyB64u,
      timestamp: now(),
    });
    if (!createFinishResult.ok) {
      state.failCreateFinish(createFinishResult.error.code);
      return toError(createFinishResult.error.code, 'create.finish');
    }

    state.completeCreateFinish(createFinishResult.data);
    state.setCreatedProfile(input.profile);

    return {
      ok: true,
      data: {
        shareUrl: createFinishResult.data.shareUrl,
        manageUrl: createFinishResult.data.manageUrl,
        shareUrlWithFragment: buildShareUrlWithFragment(
          createFinishResult.data.shareUrl,
          lockSecretB64u
        ),
        lockSecretB64u,
        lockKeyB64u,
      },
    };
  }

  async function lockChannel(
    input: LockChannelInput
  ): Promise<CryptoOrchestratorResult<LockChannelOutput>> {
    const passphraseError = ensurePassphrase(input.passphrase, 'lock.validate');
    if (passphraseError) return passphraseError;

    const lockSecretError = parseLockSecret(input.lockSecretB64u);
    if (lockSecretError) return lockSecretError;

    const state = lockStore.getState();
    state.setPassphrase(input.passphrase);
    state.startLockBegin();

    const lockBeginResult = await client.lockBegin({ uuid: input.uuid });
    if (!lockBeginResult.ok) {
      state.failLockBegin(lockBeginResult.error.code);
      return toError(lockBeginResult.error.code, 'lock.begin');
    }
    state.completeLockBegin(lockBeginResult.data as LockBeginResponse);

    const lockChallenge = lockBeginResult.data.lockChallenge;
    if (!lockChallenge) {
      return toError('MISSING_LOCK_CHALLENGE', 'lock.begin');
    }

    const receiverKeyPair = await generateReceiverKeyPair();
    const receiverPubJwk = await exportReceiverPublicKeyToJwk(receiverKeyPair.publicKey);
    const receiverPubFpr = await computeReceiverPubFingerprint(receiverKeyPair.publicKey);

    let lockKeyB64u: Base64Url;
    let lockProof: HexString;
    try {
      lockKeyB64u = await deriveLockKeyB64u(input.uuid, input.lockSecretB64u);
      lockProof = await deriveLockProofHex({
        uuid: input.uuid,
        lockChallengeId: lockChallenge.id,
        lockChallenge: lockChallenge.challenge,
        lockKeyB64u,
      });
    } catch (error) {
      return toError(
        'CRYPTO_ERROR',
        'lock.proof',
        error instanceof Error ? error.message : undefined
      );
    }

    try {
      const wrappedPrivateKey = await wrapPrivateKey({
        privateKey: receiverKeyPair.privateKey,
        password: input.passphrase,
      });
      const envelope: ReceiverKeyEnvelope = {
        uuid: asUuid(input.uuid),
        receiverPubFpr,
        wrappedPrivateKey,
        updatedAt: now(),
      };
      await receiverKeyStorage.save(envelope);
    } catch (error) {
      return toError(toStorageErrorCode(error), 'lock.persist');
    }

    state.startLockCommit();
    const lockedAt = asUnixMs(now());
    const receiverPubJwkForApi = toApiReceiverPubJwk(receiverPubJwk);
    const lockCommitResult = await client.lockCommit({
      uuid: input.uuid,
      lockChallengeId: lockChallenge.id,
      lockProof,
      receiverPubJwk: receiverPubJwkForApi,
      receiverPubFpr,
      lockedAt,
    });
    if (!lockCommitResult.ok) {
      state.failLockCommit(lockCommitResult.error.code);
      return toError(lockCommitResult.error.code, 'lock.commit');
    }

    state.completeLockCommit(lockCommitResult.data);
    state.setReceiverIdentity({ receiverPubJwk, receiverPubFpr, lockedAt });
    state.setSafetyCode(deriveSafetyCodeDisplay(receiverPubFpr));
    state.markLocked();

    return {
      ok: true,
      data: {
        receiverPubJwk,
        receiverPubFpr,
      },
    };
  }

  async function deliverSecret(
    input: DeliverSecretInput
  ): Promise<CryptoOrchestratorResult<DeliverSecretOutput>> {
    const state = deliverStore.getState();
    state.startCompoundBegin();

    const compoundBeginResult = await client.compoundBegin({ uuid: input.uuid });
    if (!compoundBeginResult.ok) {
      state.failCompoundBegin(compoundBeginResult.error.code);
      return toError(compoundBeginResult.error.code, 'deliver.begin');
    }
    state.completeCompoundBegin(compoundBeginResult.data as CompoundBeginResponse);

    const challenge = compoundBeginResult.data.challenge;
    const receiverPubJwk = compoundBeginResult.data.receiverPubJwk;
    const receiverPubFpr = compoundBeginResult.data.receiverPubFpr;
    if (!challenge) {
      return toError('MISSING_LOCK_CHALLENGE', 'deliver.validate');
    }
    if (!receiverPubJwk || !receiverPubFpr) {
      return toError('MISSING_RECEIVER_IDENTITY', 'deliver.validate');
    }

    const plaintextBytes = toPlaintextBytes(input.plaintext);
    const aad = toUtf8Bytes(input.uuid);
    const aesKey = await generateAesKey();
    const rawContentKey = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey));
    const encrypted = await encryptAesGcm({ key: aesKey, plaintext: plaintextBytes, aad });
    const receiverPublicKey = await importReceiverPublicKeyFromJwk(receiverPubJwk);
    const encContentKey = await wrapContentKey({
      receiverPublicKey,
      contentKey: rawContentKey,
    });
    const ciphertextHash = await computeSha256Hex(encrypted.ciphertext);

    const cipherBundle = toCipherBundleTransport({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      aad,
      encContentKey,
      ciphertextHash,
      padBlock: encrypted.padBlock,
    });

    const intent: UpdateIntent = {
      op: 'update',
      uuid: asUuid(input.uuid),
      version: compoundBeginResult.data.currentVersion,
      timestamp: asUnixMs(now()),
      nonce: randomBase64Url(NONCE_BYTES, randomBytes),
      receiverPubFpr,
      cipherBundle,
      expireAt: input.expireAt == null ? null : asUnixMs(input.expireAt),
    };

    const intentHash = await computeIntentHash(intent as unknown as Record<string, unknown>);
    const expectedChallenge = await deriveExpectedCompoundChallengeB64u({
      uuid: input.uuid,
      challengeId: challenge.id,
      challengeSeed: challenge.seed,
      intentHash,
    });

    state.startCompoundCommit();
    const assertionResult = await assertWithWebAuthn({
      profile: input.profile,
      requestOptions: {
        publicKey: {
          challenge: expectedChallenge,
        },
      },
    });
    if (!assertionResult.ok) {
      state.failCompoundCommit(assertionResult.error.code);
      return mapWebAuthnError(assertionResult.error.code, 'deliver.assert');
    }

    const compoundCommitResult = await client.compoundCommit({
      uuid: input.uuid,
      assertion: assertionResult.data as AssertionJSON,
      intentHash,
      intent,
    });
    if (!compoundCommitResult.ok) {
      state.failCompoundCommit(compoundCommitResult.error.code);
      return toError(compoundCommitResult.error.code, 'deliver.commit');
    }

    state.completeCompoundCommit(compoundCommitResult.data);
    state.markDelivered();

    return {
      ok: true,
      data: {
        intentHash,
        intent,
        expectedChallenge,
        cipherBundle,
      },
    };
  }

  async function deleteChannel(
    input: DeleteChannelInput
  ): Promise<CryptoOrchestratorResult<DeleteChannelOutput>> {
    const state = deliverStore.getState();
    state.startCompoundBegin();

    const compoundBeginResult = await client.compoundBegin({ uuid: input.uuid });
    if (!compoundBeginResult.ok) {
      state.failCompoundBegin(compoundBeginResult.error.code);
      return toError(compoundBeginResult.error.code, 'delete.begin');
    }
    state.completeCompoundBegin(compoundBeginResult.data as CompoundBeginResponse);

    const challenge = compoundBeginResult.data.challenge;
    if (!challenge) {
      return toError('MISSING_LOCK_CHALLENGE', 'delete.validate');
    }

    const intent: DeleteIntent = {
      op: 'delete',
      uuid: asUuid(input.uuid),
      version: compoundBeginResult.data.currentVersion,
      timestamp: asUnixMs(now()),
      nonce: randomBase64Url(NONCE_BYTES, randomBytes),
    };

    const intentHash = await computeIntentHash(intent as unknown as Record<string, unknown>);
    const expectedChallenge = await deriveExpectedCompoundChallengeB64u({
      uuid: input.uuid,
      challengeId: challenge.id,
      challengeSeed: challenge.seed,
      intentHash,
    });

    state.startCompoundCommit();
    const assertionResult = await assertWithWebAuthn({
      profile: input.profile,
      requestOptions: {
        publicKey: {
          challenge: expectedChallenge,
        },
      },
    });
    if (!assertionResult.ok) {
      state.failCompoundCommit(assertionResult.error.code);
      return mapWebAuthnError(assertionResult.error.code, 'delete.assert');
    }

    const deleteCommitResult = await client.deleteCommit({
      uuid: input.uuid,
      assertion: assertionResult.data as AssertionJSON,
      intentHash,
      intent,
    });
    if (!deleteCommitResult.ok) {
      state.failCompoundCommit(deleteCommitResult.error.code);
      return toError(deleteCommitResult.error.code, 'delete.commit');
    }

    state.completeCompoundCommit(deleteCommitResult.data);
    state.markDeleted();

    return {
      ok: true,
      data: {
        intentHash,
        intent,
        expectedChallenge,
      },
    };
  }

  async function decryptDelivered(
    input: DecryptDeliveredInput
  ): Promise<CryptoOrchestratorResult<DecryptDeliveredOutput>> {
    const passphraseError = ensurePassphrase(input.passphrase, 'decrypt.validate');
    if (passphraseError) return passphraseError;

    const state = decryptStore.getState();
    state.startPublicStatus();

    const publicStatusResult = await client.publicStatus(input.uuid);
    if (!publicStatusResult.ok) {
      state.failPublicStatus(publicStatusResult.error.code);
      return toError(publicStatusResult.error.code, 'decrypt.public-status');
    }
    state.completePublicStatus(publicStatusResult.data);
    if (!isDeliveredState(publicStatusResult.data.state)) {
      return toError('CHANNEL_NOT_DELIVERED', 'decrypt.public-status');
    }

    state.startDecryptFetch();
    const decryptFetchResult = await client.decryptFetch(input.uuid);
    if (!decryptFetchResult.ok) {
      state.failDecryptFetch(decryptFetchResult.error.code);
      return toError(decryptFetchResult.error.code, 'decrypt.fetch');
    }
    state.completeDecryptFetch(decryptFetchResult.data as DecryptFetchResponse);

    const payload = decryptFetchResult.data;
    const ciphertextBytes = decodeBase64UrlBytes(payload.cipherBundle.ciphertext);
    const computedHash = await computeSha256Hex(ciphertextBytes);
    if (computedHash !== payload.cipherBundle.ciphertextHash) {
      return toError('INTEGRITY_MISMATCH', 'decrypt.verify');
    }

    let envelope: ReceiverKeyEnvelope | null;
    try {
      envelope = await receiverKeyStorage.load(input.uuid);
    } catch (error) {
      return toError(toStorageErrorCode(error), 'decrypt.load-key');
    }
    if (!envelope) {
      return toError('KEY_STORAGE_ERROR', 'decrypt.load-key', 'receiver private key is missing');
    }

    try {
      const receiverPrivateKey = await unwrapPrivateKey({
        wrapped: envelope.wrappedPrivateKey,
        password: input.passphrase,
      });
      const contentKeyBytes = await unwrapContentKey({
        receiverPrivateKey,
        wrappedKey: decodeBase64UrlBytes(payload.cipherBundle.encContentKey),
      });
      const contentKey = await crypto.subtle.importKey(
        'raw',
        toArrayBuffer(contentKeyBytes),
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );
      const plaintextBytes = await decryptAesGcm({
        key: contentKey,
        ciphertext: ciphertextBytes,
        iv: decodeBase64UrlBytes(payload.cipherBundle.iv),
        aad: decodeBase64UrlBytes(payload.cipherBundle.aad),
      });
      const plaintext = new TextDecoder().decode(plaintextBytes);
      state.setPlaintext(plaintext);
      return {
        ok: true,
        data: {
          plaintext,
          plaintextBytes,
          deliveredAt: payload.deliveredAt,
          receiverPubFpr: payload.receiverPubFpr,
        },
      };
    } catch (error) {
      return toError(
        'CRYPTO_ERROR',
        'decrypt.crypto',
        error instanceof Error ? error.message : undefined
      );
    }
  }

  return {
    createChannel,
    lockChannel,
    deliverSecret,
    deleteChannel,
    decryptDelivered,
  };
}

export const cryptoOrchestrator = createCryptoOrchestrator();
