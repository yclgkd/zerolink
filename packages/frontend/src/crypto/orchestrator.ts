import type { CredentialCreationOptionsJSON } from '@github/webauthn-json';
import {
  AES_GCM,
  type AssertionJSON,
  type AttestationJSON,
  type Base64Url,
  buildCipherBundleAadBytes,
  type ChannelState,
  type CipherBundle,
  type CompoundBeginResponse,
  computeIntentHash,
  type DecryptFetchResponse,
  type DeleteIntent,
  type ECDSAPublicKeyJWK,
  type HexString,
  type LockBeginResponse,
  NONCE_BYTES,
  type RSAPublicKeyJWK,
  SECURITY_PROFILE,
  type SecurityProfile,
  type UnixMs,
  type UpdateIntent,
  type UUID,
} from '@zerolink/shared';
import {
  decryptAesGcm,
  encryptAesGcm,
  importAesKeyFromBytes,
  wipeBytes,
} from '@zerolink/shared/crypto/aes';
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
import { getPassphraseLengthMessage, validatePassphrase } from './passphrase-policy';
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
  exportSoftkeyPublicJwk,
  generateSoftkeyPair,
  softkeySign,
  unwrapSoftkeyPrivateKey,
  wrapSoftkeyPrivateKey,
} from './softkey';
import {
  createIndexedDbPendingSoftkeyCleanupStorage,
  createIndexedDbReceiverKeyStorage,
  createIndexedDbSoftkeyAdminStorage,
  type PendingSoftkeyCleanupStorage,
  type ReceiverKeyEnvelope,
  type ReceiverKeyStorage,
  type SoftkeyAdminStorage,
} from './storage';
import {
  assertWithWebAuthn,
  registerWithWebAuthn,
  type WebAuthnAdapterErrorCode,
} from './webauthn';

/**
 * Known error codes returned by the CryptoOrchestrator flows.
 */
export type CryptoOrchestratorErrorCode =
  | 'API_ERROR'
  | 'WEBAUTHN_ERROR'
  | 'FALLBACK_REQUIRED'
  | 'PROFILE_BLOCKED'
  | 'ATTESTATION_UNVERIFIABLE'
  | 'INVALID_LOCK_SECRET'
  | 'MISSING_LOCK_CHALLENGE'
  | 'MISSING_RECEIVER_IDENTITY'
  | 'KEY_STORAGE_ERROR'
  | 'PASSPHRASE_REQUIRED'
  | 'CHANNEL_NOT_DELIVERED'
  | 'INTEGRITY_MISMATCH'
  | 'CRYPTO_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Error envelope containing details about where and why a cryptographic flow failed.
 */
export interface CryptoOrchestratorError {
  ok: false;
  code: CryptoOrchestratorErrorCode | string;
  stage: string;
  message?: string;
}

/**
 * Result union representing either success with data or failure with an orchestrator error.
 */
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

/**
 * Dependency injection mapping for the CryptoOrchestrator.
 */
export interface CryptoOrchestratorDeps {
  apiClient?: ApiClient;
  receiverKeyStorage?: ReceiverKeyStorage;
  softkeyAdminStorage?: SoftkeyAdminStorage;
  pendingSoftkeyCleanupStorage?: PendingSoftkeyCleanupStorage;
  createStore?: CreateStore;
  lockStore?: LockStore;
  deliverStore?: DeliverStore;
  decryptStore?: DecryptStore;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
}

/**
 * Input for the createChannel flow.
 */
export interface CreateChannelInput {
  uuid: string;
  profile: SecurityProfile;
  lockSecretB64u?: string;
  useCompatibilityMode?: boolean;
  /** Required when useCompatibilityMode is true. Used as Argon2id passphrase to wrap the softkey private key. Must be a user-supplied secret, never the channel UUID. */
  softkeyPassphrase?: string;
}

/**
 * Output of a successful createChannel flow.
 */
export interface CreateChannelOutput {
  shareUrl: string;
  manageUrl: string;
  shareUrlWithFragment: string;
  lockSecretB64u: string;
  lockKeyB64u: string;
}

/**
 * Input for the lockChannel flow.
 */
export interface LockChannelInput {
  uuid: string;
  lockSecretB64u: string;
  passphrase: string;
}

/**
 * Output of a successful lockChannel flow.
 */
export interface LockChannelOutput {
  receiverPubJwk: RSAPublicKeyJWK;
  receiverPubFpr: HexString;
}

/**
 * Input for the deliverSecret flow.
 */
export interface DeliverSecretInput {
  uuid: string;
  profile: SecurityProfile;
  plaintext: string | Uint8Array;
  expireAt?: number | null;
  /** Required when the channel uses softkey compatibility mode. Must match the passphrase used at create time. */
  softkeyPassphrase?: string;
}

/**
 * Output of a successful deliverSecret flow.
 */
export interface DeliverSecretOutput {
  intentHash: string;
  intent: UpdateIntent;
  expectedChallenge: string;
  cipherBundle: CipherBundle;
}

/**
 * Input for the deleteChannel flow.
 */
export interface DeleteChannelInput {
  uuid: string;
  profile: SecurityProfile;
  /** Required when the channel uses softkey compatibility mode. Must match the passphrase used at create time. */
  softkeyPassphrase?: string;
}

/**
 * Output of a successful deleteChannel flow.
 */
export interface DeleteChannelOutput {
  intentHash: string;
  intent: DeleteIntent;
  expectedChallenge: string;
}

/**
 * Input for the decryptDelivered flow.
 */
export interface DecryptDeliveredInput {
  uuid: string;
  passphrase: string;
}

/**
 * Output of a successful decryptDelivered flow.
 */
export interface DecryptDeliveredOutput {
  plaintext: string;
  deliveredAt: number;
  receiverPubFpr: string;
}

/**
 * The high-level orchestrator that drives complex zero-knowledge workflows.
 */
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

interface ResolvedDeps {
  client: ApiClient;
  receiverKeyStorage: ReceiverKeyStorage;
  softkeyAdminStorage: SoftkeyAdminStorage;
  pendingSoftkeyCleanupStorage: PendingSoftkeyCleanupStorage;
  createStore: CreateStore;
  lockStore: LockStore;
  deliverStore: DeliverStore;
  decryptStore: DecryptStore;
  now: () => number;
  randomBytes: (length: number) => Uint8Array;
}

type ResolvedDeliverBeginData = CompoundBeginResponse & {
  challenge: NonNullable<CompoundBeginResponse['challenge']>;
  receiverPubJwk: NonNullable<CompoundBeginResponse['receiverPubJwk']>;
  receiverPubFpr: NonNullable<CompoundBeginResponse['receiverPubFpr']>;
};

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
  const validationResult = validatePassphrase(passphrase);
  if (validationResult === 'missing') {
    return toError('PASSPHRASE_REQUIRED', stage);
  }
  if (validationResult === 'too_short') {
    return toError('PASSPHRASE_REQUIRED', stage, getPassphraseLengthMessage());
  }
  return null;
}

function toUtf8Bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function asUuid(value: string): UUID {
  return value as UUID;
}

function asUnixMs(value: number): UnixMs {
  return value as UnixMs;
}

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
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

function resolvePadBlockForProfile(profile: SecurityProfile): number {
  switch (profile) {
    case SECURITY_PROFILE.SECURE:
    case SECURITY_PROFILE.STRICT:
    case SECURITY_PROFILE.HARDWARE_ONLY:
      return AES_GCM.PAD_BLOCK_STRICT;
    case SECURITY_PROFILE.QUICK:
    case SECURITY_PROFILE.STANDARD:
      return AES_GCM.PAD_BLOCK_DEFAULT;
  }
}

function randomBase64Url(length: number, randomBytes: (length: number) => Uint8Array): Base64Url {
  return encodeBase64UrlBytes(randomBytes(length));
}

function toPlaintextBytes(value: string | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    return toUtf8Bytes(value);
  }
  return Uint8Array.from(value);
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

type DeliverStoreStateSnapshot = ReturnType<DeliverStore['getState']>;
type DecryptStoreStateSnapshot = ReturnType<DecryptStore['getState']>;

function canApplyDeliverStoreUpdate(uuid: string, state: DeliverStoreStateSnapshot): boolean {
  return state.uuid === null || state.uuid === uuid;
}

function applyDeliverStoreUpdate(
  deliverStore: DeliverStore,
  uuid: string,
  apply: (state: DeliverStoreStateSnapshot) => void
): void {
  const state = deliverStore.getState();
  if (!canApplyDeliverStoreUpdate(uuid, state)) return;
  apply(state);
}

function canApplyDecryptStoreUpdate(uuid: string, state: DecryptStoreStateSnapshot): boolean {
  return state.uuid === null || state.uuid === uuid;
}

function applyDecryptStoreUpdate(
  decryptStore: DecryptStore,
  uuid: string,
  apply: (state: DecryptStoreStateSnapshot) => void
): void {
  const state = decryptStore.getState();
  if (!canApplyDecryptStoreUpdate(uuid, state)) return;
  apply(state);
}

async function retryPendingSoftkeyCleanup(
  softkeyAdminStorage: SoftkeyAdminStorage,
  pendingSoftkeyCleanupStorage: PendingSoftkeyCleanupStorage
): Promise<void> {
  let pendingRecords: Awaited<ReturnType<PendingSoftkeyCleanupStorage['list']>>;
  try {
    pendingRecords = await pendingSoftkeyCleanupStorage.list();
  } catch {
    return;
  }

  for (const record of pendingRecords) {
    try {
      const envelope = await softkeyAdminStorage.load(record.uuid);
      if (!envelope) {
        await pendingSoftkeyCleanupStorage.clear(record.uuid);
        continue;
      }

      if (envelope.createdAt > record.markedAt) {
        await pendingSoftkeyCleanupStorage.clear(record.uuid);
        continue;
      }

      await softkeyAdminStorage.remove(record.uuid);
      await pendingSoftkeyCleanupStorage.clear(record.uuid);
    } catch {
      // Keep pending record for next retry.
    }
  }
}

async function executeCreateChannel(
  deps: ResolvedDeps,
  input: CreateChannelInput
): Promise<CryptoOrchestratorResult<CreateChannelOutput>> {
  await retryPendingSoftkeyCleanup(deps.softkeyAdminStorage, deps.pendingSoftkeyCleanupStorage);
  if (input.useCompatibilityMode) {
    const passphraseError = ensurePassphrase(
      input.softkeyPassphrase ?? '',
      'create.softkey-passphrase'
    );
    if (passphraseError) {
      return passphraseError;
    }
  }

  const state = deps.createStore.getState();
  state.startCreateBegin();

  const beginRes = await deps.client.createBegin({
    uuid: input.uuid,
    timestamp: deps.now(),
    securityProfile: input.profile,
  });
  if (!beginRes.ok) {
    state.failCreateBegin(beginRes.error.code);
    return toError(beginRes.error.code, 'create.begin');
  }

  state.completeCreateBegin(beginRes.data);
  const lockSecretB64u = input.lockSecretB64u ?? randomBase64Url(32, deps.randomBytes);

  let lockKeyB64u: Base64Url;
  try {
    lockKeyB64u = await deriveLockKeyB64u(input.uuid, lockSecretB64u);
  } catch {
    return toError('CRYPTO_ERROR', 'create.lock-key');
  }

  if (input.useCompatibilityMode) {
    const softkeyPassphrase = input.softkeyPassphrase ?? '';
    let softkeyPubJwk: ECDSAPublicKeyJWK;
    try {
      const keypair = await generateSoftkeyPair();
      softkeyPubJwk = await exportSoftkeyPublicJwk(keypair.publicKey);
      const wrappedPrivateKey = await wrapSoftkeyPrivateKey(keypair.privateKey, softkeyPassphrase);
      await deps.softkeyAdminStorage.save({
        uuid: input.uuid,
        softkeyPubJwk,
        wrappedPrivateKey,
        createdAt: deps.now(),
      });
    } catch {
      state.failCreateFinish('CRYPTO_ERROR');
      return toError('CRYPTO_ERROR', 'create.softkey');
    }

    state.startCreateFinish();
    const finishRes = await deps.client.createFinish({
      adminMode: 'password',
      uuid: input.uuid,
      softkeyPubJwk,
      lockKeyB64u,
      timestamp: deps.now(),
    });
    if (!finishRes.ok) {
      let cleanupFailed = false;
      try {
        await deps.softkeyAdminStorage.remove(input.uuid);
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        try {
          await deps.pendingSoftkeyCleanupStorage.mark(input.uuid, deps.now());
        } catch {
          // Ignore mark failure to preserve create.finish error semantics.
        }
      }
      state.failCreateFinish(finishRes.error.code);
      return cleanupFailed
        ? toError(finishRes.error.code, 'create.finish', 'cleanup failed after create.finish')
        : toError(finishRes.error.code, 'create.finish');
    }

    state.completeCreateFinish(finishRes.data);
    state.setCreatedProfile(input.profile);

    return {
      ok: true,
      data: {
        shareUrl: finishRes.data.shareUrl,
        manageUrl: finishRes.data.manageUrl,
        shareUrlWithFragment: buildShareUrlWithFragment(finishRes.data.shareUrl, lockSecretB64u),
        lockSecretB64u,
        lockKeyB64u,
      },
    };
  }

  const regRes = await registerWithWebAuthn({
    profile: input.profile,
    creationOptions: beginRes.data.creationOptions as unknown as CredentialCreationOptionsJSON,
  });
  if (!regRes.ok) {
    state.failCreateFinish(regRes.error.code);
    return mapWebAuthnError(regRes.error.code, 'create.register');
  }

  state.startCreateFinish();
  const finishRes = await deps.client.createFinish({
    adminMode: 'webauthn',
    uuid: input.uuid,
    attestation: regRes.data as AttestationJSON,
    lockKeyB64u,
    timestamp: deps.now(),
  });
  if (!finishRes.ok) {
    state.failCreateFinish(finishRes.error.code);
    return toError(finishRes.error.code, 'create.finish');
  }

  state.completeCreateFinish(finishRes.data);
  state.setCreatedProfile(input.profile);

  return {
    ok: true,
    data: {
      shareUrl: finishRes.data.shareUrl,
      manageUrl: finishRes.data.manageUrl,
      shareUrlWithFragment: buildShareUrlWithFragment(finishRes.data.shareUrl, lockSecretB64u),
      lockSecretB64u,
      lockKeyB64u,
    },
  };
}

async function prepareLockCryptography(
  uuid: string,
  lockSecretB64u: string,
  passphrase: string,
  lockChallengeId: string,
  lockChallenge: string,
  nowMs: number
) {
  const receiverKeyPair = await generateReceiverKeyPair();
  const receiverPubJwk = await exportReceiverPublicKeyToJwk(receiverKeyPair.publicKey);
  const receiverPubFpr = await computeReceiverPubFingerprint(receiverKeyPair.publicKey);

  const lockKeyB64u = await deriveLockKeyB64u(uuid, lockSecretB64u);
  const lockProof = await deriveLockProofHex({
    uuid,
    lockChallengeId,
    lockChallenge,
    lockKeyB64u,
  });

  const wrappedPrivateKey = await wrapPrivateKey({
    privateKey: receiverKeyPair.privateKey,
    password: passphrase,
  });

  return {
    receiverPubJwk,
    receiverPubFpr,
    lockProof,
    envelope: {
      uuid: asUuid(uuid),
      receiverPubFpr,
      wrappedPrivateKey,
      updatedAt: nowMs,
    },
  };
}

async function executeLockChannel(
  deps: ResolvedDeps,
  input: LockChannelInput
): Promise<CryptoOrchestratorResult<LockChannelOutput>> {
  const errPass = ensurePassphrase(input.passphrase, 'lock.validate');
  if (errPass) return errPass;
  const errLock = parseLockSecret(input.lockSecretB64u);
  if (errLock) return errLock;

  const state = deps.lockStore.getState();
  state.setPassphrase(input.passphrase);
  state.startLockBegin();

  const beginRes = await deps.client.lockBegin({ uuid: input.uuid });
  if (!beginRes.ok) {
    state.failLockBegin(beginRes.error.code);
    return toError(beginRes.error.code, 'lock.begin');
  }
  state.completeLockBegin(beginRes.data as LockBeginResponse);

  const challenge = beginRes.data.lockChallenge;
  if (!challenge) return toError('MISSING_LOCK_CHALLENGE', 'lock.begin');

  const nowMs = deps.now();
  let cryptoData: Awaited<ReturnType<typeof prepareLockCryptography>>;
  try {
    cryptoData = await prepareLockCryptography(
      input.uuid,
      input.lockSecretB64u,
      input.passphrase,
      challenge.id,
      challenge.challenge,
      nowMs
    );
  } catch {
    return toError('CRYPTO_ERROR', 'lock.crypto');
  }

  try {
    await deps.receiverKeyStorage.save(cryptoData.envelope);
  } catch (error) {
    return toError(toStorageErrorCode(error), 'lock.persist');
  }

  state.startLockCommit();
  const lockedAt = asUnixMs(nowMs);
  const commitRes = await deps.client.lockCommit({
    uuid: input.uuid,
    lockChallengeId: challenge.id,
    lockProof: cryptoData.lockProof,
    receiverPubJwk: toApiReceiverPubJwk(cryptoData.receiverPubJwk),
    receiverPubFpr: cryptoData.receiverPubFpr,
    lockedAt,
  });
  if (!commitRes.ok) {
    state.failLockCommit(commitRes.error.code);
    return toError(commitRes.error.code, 'lock.commit');
  }

  state.completeLockCommit(commitRes.data);
  state.setReceiverIdentity({
    receiverPubJwk: cryptoData.receiverPubJwk,
    receiverPubFpr: cryptoData.receiverPubFpr,
    lockedAt,
  });
  state.setSafetyCode(deriveSafetyCodeDisplay(cryptoData.receiverPubFpr));
  state.markLocked();

  return {
    ok: true,
    data: {
      receiverPubJwk: cryptoData.receiverPubJwk,
      receiverPubFpr: cryptoData.receiverPubFpr,
    },
  };
}

async function buildDeliverUpdateIntent(
  deps: ResolvedDeps,
  input: DeliverSecretInput,
  beginData: ResolvedDeliverBeginData
) {
  let plaintextBytes: Uint8Array | null = null;
  let aad: Uint8Array | null = null;
  let rawContentKey: Uint8Array | null = null;
  let encrypted: Awaited<ReturnType<typeof encryptAesGcm>> | null = null;
  let encContentKey: Uint8Array | null = null;

  try {
    plaintextBytes = toPlaintextBytes(input.plaintext);
    aad = buildCipherBundleAadBytes({
      uuid: asUuid(input.uuid),
      version: beginData.currentVersion,
      receiverPubFpr: beginData.receiverPubFpr,
    });
    rawContentKey = deps.randomBytes(AES_GCM.KEY_LENGTH_BITS / 8);
    const aesKey = await importAesKeyFromBytes(rawContentKey, ['encrypt', 'decrypt']);
    encrypted = await encryptAesGcm({
      key: aesKey,
      plaintext: plaintextBytes,
      aad,
      padBlock: resolvePadBlockForProfile(input.profile),
    });
    const receiverPublicKey = await importReceiverPublicKeyFromJwk(beginData.receiverPubJwk);
    encContentKey = await wrapContentKey({
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
      version: beginData.currentVersion,
      timestamp: asUnixMs(deps.now()),
      nonce: randomBase64Url(NONCE_BYTES, deps.randomBytes),
      receiverPubFpr: beginData.receiverPubFpr,
      cipherBundle,
      expireAt: input.expireAt == null ? null : asUnixMs(input.expireAt),
    };

    const intentHash = await computeIntentHash(intent as unknown as Record<string, unknown>);
    const expectedChallenge = await deriveExpectedCompoundChallengeB64u({
      uuid: input.uuid,
      challengeId: beginData.challenge.id,
      challengeSeed: beginData.challenge.seed,
      intentHash,
    });

    return { intent, intentHash, expectedChallenge, cipherBundle };
  } finally {
    wipeBytes(plaintextBytes);
    wipeBytes(aad);
    wipeBytes(rawContentKey);
    wipeBytes(encContentKey);
    wipeBytes(encrypted?.iv);
    wipeBytes(encrypted?.ciphertext);
  }
}

/**
 * Loads the stored softkey envelope for `uuid`, unwraps the private key with
 * `passphrase`, and signs `expectedChallengeB64u` (decoded to raw bytes).
 * Shared by executeDeliverSecret and executeDeleteChannel.
 */
async function signChallengeWithSoftkey(
  softkeyAdminStorage: SoftkeyAdminStorage,
  uuid: string,
  passphrase: string,
  expectedChallengeB64u: Base64Url
): Promise<HexString> {
  const envelope = await softkeyAdminStorage.load(uuid);
  if (!envelope) throw new Error('missing softkey');
  const privateKey = await unwrapSoftkeyPrivateKey(envelope.wrappedPrivateKey, passphrase);
  return softkeySign(privateKey, decodeBase64UrlBytes(expectedChallengeB64u));
}

async function executeDeliverSecret(
  deps: ResolvedDeps,
  input: DeliverSecretInput
): Promise<CryptoOrchestratorResult<DeliverSecretOutput>> {
  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.startCompoundBegin();
  });

  const beginRes = await deps.client.compoundBegin({ uuid: input.uuid });
  if (!beginRes.ok) {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundBegin(beginRes.error.code);
    });
    return toError(beginRes.error.code, 'deliver.begin');
  }
  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.completeCompoundBegin(beginRes.data as CompoundBeginResponse);
  });

  const beginData = beginRes.data;
  if (!beginData.challenge) return toError('MISSING_LOCK_CHALLENGE', 'deliver.validate');
  if (!beginData.receiverPubJwk || !beginData.receiverPubFpr)
    return toError('MISSING_RECEIVER_IDENTITY', 'deliver.validate');

  const resolvedBeginData = {
    ...beginData,
    challenge: beginData.challenge,
    receiverPubJwk: beginData.receiverPubJwk,
    receiverPubFpr: beginData.receiverPubFpr,
  } as ResolvedDeliverBeginData;

  let intentData: Awaited<ReturnType<typeof buildDeliverUpdateIntent>>;
  try {
    intentData = await buildDeliverUpdateIntent(deps, input, resolvedBeginData);
  } catch {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundCommit('CRYPTO_ERROR');
    });
    return toError('CRYPTO_ERROR', 'deliver.crypto');
  }

  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.startCompoundCommit();
  });

  let assertion: AssertionJSON | undefined;
  let softkeySignature: HexString | undefined;

  const deliverIsPasswordMode =
    resolvedBeginData.adminMode === 'password' || resolvedBeginData.adminMode === 'softkey';

  if (deliverIsPasswordMode) {
    const softkeyPassphrase = input.softkeyPassphrase ?? '';
    const passphraseError = ensurePassphrase(softkeyPassphrase, 'deliver.softkey-passphrase');
    if (passphraseError) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('PASSPHRASE_REQUIRED');
      });
      return passphraseError;
    }
    try {
      softkeySignature = await signChallengeWithSoftkey(
        deps.softkeyAdminStorage,
        input.uuid,
        softkeyPassphrase,
        intentData.expectedChallenge as Base64Url
      );
    } catch {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('CRYPTO_ERROR');
      });
      return toError('CRYPTO_ERROR', 'deliver.softkey');
    }
  } else {
    const assertRes = await assertWithWebAuthn({
      profile: input.profile,
      requestOptions: {
        publicKey: {
          challenge: intentData.expectedChallenge,
          ...(resolvedBeginData.allowCredentials
            ? { allowCredentials: resolvedBeginData.allowCredentials }
            : {}),
        },
      },
    });
    if (!assertRes.ok) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit(assertRes.error.code);
      });
      return mapWebAuthnError(assertRes.error.code, 'deliver.assert');
    }
    assertion = assertRes.data as AssertionJSON;
  }

  const commitPayload = softkeySignature
    ? {
        adminMode: resolvedBeginData.adminMode as 'password' | 'softkey',
        uuid: input.uuid,
        softkeySignature,
        intentHash: intentData.intentHash,
        intent: intentData.intent,
      }
    : {
        uuid: input.uuid,
        assertion: assertion as AssertionJSON,
        intentHash: intentData.intentHash,
        intent: intentData.intent,
      };

  const commitRes = await deps.client.compoundCommit(commitPayload);
  if (!commitRes.ok) {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundCommit(commitRes.error.code);
    });
    return toError(commitRes.error.code, 'deliver.commit');
  }

  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.completeCompoundCommit(commitRes.data);
    state.markDelivered();
  });

  return { ok: true, data: intentData };
}

async function executeDeleteChannel(
  deps: ResolvedDeps,
  input: DeleteChannelInput
): Promise<CryptoOrchestratorResult<DeleteChannelOutput>> {
  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.startCompoundBegin();
  });

  const beginRes = await deps.client.compoundBegin({ uuid: input.uuid });
  if (!beginRes.ok) {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundBegin(beginRes.error.code);
    });
    return toError(beginRes.error.code, 'delete.begin');
  }
  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.completeCompoundBegin(beginRes.data as CompoundBeginResponse);
  });

  const beginData = beginRes.data;
  if (!beginData.challenge) return toError('MISSING_LOCK_CHALLENGE', 'delete.validate');

  const intent: DeleteIntent = {
    op: 'delete',
    uuid: asUuid(input.uuid),
    version: beginData.currentVersion,
    timestamp: asUnixMs(deps.now()),
    nonce: randomBase64Url(NONCE_BYTES, deps.randomBytes),
  };

  const intentHash = await computeIntentHash(intent as unknown as Record<string, unknown>);
  const expectedChallenge = await deriveExpectedCompoundChallengeB64u({
    uuid: input.uuid,
    challengeId: beginData.challenge.id,
    challengeSeed: beginData.challenge.seed,
    intentHash,
  });

  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.startCompoundCommit();
  });

  let assertion: AssertionJSON | undefined;
  let softkeySignature: HexString | undefined;

  const deleteIsPasswordMode =
    beginData.adminMode === 'password' || beginData.adminMode === 'softkey';

  if (deleteIsPasswordMode) {
    const softkeyPassphrase = input.softkeyPassphrase ?? '';
    const passphraseError = ensurePassphrase(softkeyPassphrase, 'delete.softkey-passphrase');
    if (passphraseError) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('PASSPHRASE_REQUIRED');
      });
      return passphraseError;
    }
    try {
      softkeySignature = await signChallengeWithSoftkey(
        deps.softkeyAdminStorage,
        input.uuid,
        softkeyPassphrase,
        expectedChallenge as Base64Url
      );
    } catch (_error) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('CRYPTO_ERROR');
      });
      return toError('CRYPTO_ERROR', 'delete.softkey');
    }
  } else {
    const assertRes = await assertWithWebAuthn({
      profile: input.profile,
      requestOptions: {
        publicKey: {
          challenge: expectedChallenge,
          ...(beginData.allowCredentials ? { allowCredentials: beginData.allowCredentials } : {}),
        },
      },
    });
    if (!assertRes.ok) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit(assertRes.error.code);
      });
      return mapWebAuthnError(assertRes.error.code, 'delete.assert');
    }
    assertion = assertRes.data as AssertionJSON;
  }

  const commitPayload = softkeySignature
    ? {
        adminMode: beginData.adminMode as 'password' | 'softkey',
        uuid: input.uuid,
        softkeySignature,
        intentHash,
        intent,
      }
    : {
        uuid: input.uuid,
        assertion: assertion as AssertionJSON,
        intentHash,
        intent,
      };

  const commitRes = await deps.client.deleteCommit(commitPayload);
  if (!commitRes.ok) {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundCommit(commitRes.error.code);
    });
    return toError(commitRes.error.code, 'delete.commit');
  }

  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.completeCompoundCommit(commitRes.data);
    state.markDeleted();
  });

  return { ok: true, data: { intentHash, intent, expectedChallenge } };
}

async function performDecryptionPipeline(
  payload: DecryptFetchResponse,
  passphrase: string,
  envelope: ReceiverKeyEnvelope,
  uuid: string
) {
  let ciphertextBytes: Uint8Array | null = null;
  let wrappedKeyBytes: Uint8Array | null = null;
  let ivBytes: Uint8Array | null = null;
  let aadBytes: Uint8Array | null = null;
  let contentKeyBytes: Uint8Array | null = null;
  let plaintextBytes: Uint8Array | null = null;

  try {
    if (!constantTimeHexEqual(payload.receiverPubFpr, envelope.receiverPubFpr)) {
      throw new Error('INTEGRITY_MISMATCH');
    }

    aadBytes = buildCipherBundleAadBytes({
      uuid: asUuid(uuid),
      version: payload.cipherVersion,
      receiverPubFpr: envelope.receiverPubFpr,
    });
    const expectedAad = encodeBase64UrlBytes(aadBytes);
    if (payload.cipherBundle.aad !== expectedAad) {
      throw new Error('INTEGRITY_MISMATCH');
    }

    ciphertextBytes = decodeBase64UrlBytes(payload.cipherBundle.ciphertext);
    const computedHash = await computeSha256Hex(ciphertextBytes);
    if (!constantTimeHexEqual(computedHash, payload.cipherBundle.ciphertextHash)) {
      throw new Error('INTEGRITY_MISMATCH');
    }

    const receiverPrivateKey = await unwrapPrivateKey({
      wrapped: envelope.wrappedPrivateKey,
      password: passphrase,
    });
    wrappedKeyBytes = decodeBase64UrlBytes(payload.cipherBundle.encContentKey);
    contentKeyBytes = await unwrapContentKey({
      receiverPrivateKey,
      wrappedKey: wrappedKeyBytes,
    });
    // L-4: Validate content key is exactly 32 bytes (AES-256)
    if (contentKeyBytes.byteLength !== AES_GCM.KEY_LENGTH_BITS / 8) {
      throw new Error('INTEGRITY_MISMATCH');
    }
    const contentKey = await importAesKeyFromBytes(contentKeyBytes, ['decrypt']);
    wipeBytes(contentKeyBytes);
    contentKeyBytes = null;
    ivBytes = decodeBase64UrlBytes(payload.cipherBundle.iv);
    plaintextBytes = await decryptAesGcm({
      key: contentKey,
      ciphertext: ciphertextBytes,
      iv: ivBytes,
      aad: aadBytes,
    });

    return {
      plaintext: new TextDecoder().decode(plaintextBytes),
    };
  } finally {
    wipeBytes(ciphertextBytes);
    wipeBytes(wrappedKeyBytes);
    wipeBytes(ivBytes);
    wipeBytes(aadBytes);
    wipeBytes(contentKeyBytes);
    wipeBytes(plaintextBytes);
  }
}

async function executeDecryptDelivered(
  deps: ResolvedDeps,
  input: DecryptDeliveredInput
): Promise<CryptoOrchestratorResult<DecryptDeliveredOutput>> {
  const passErr = ensurePassphrase(input.passphrase, 'decrypt.validate');
  if (passErr) return passErr;

  applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
    state.startPublicStatus();
  });

  const statusRes = await deps.client.publicStatus(input.uuid);
  if (!statusRes.ok) {
    applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
      state.failPublicStatus(statusRes.error.code);
    });
    return toError(statusRes.error.code, 'decrypt.public-status');
  }
  applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
    state.completePublicStatus(statusRes.data);
  });
  if (!isDeliveredState(statusRes.data.state)) {
    return toError('CHANNEL_NOT_DELIVERED', 'decrypt.public-status');
  }

  applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
    state.startDecryptFetch();
  });
  const fetchRes = await deps.client.decryptFetch(input.uuid);
  if (!fetchRes.ok) {
    applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
      state.failDecryptFetch(fetchRes.error.code);
    });
    return toError(fetchRes.error.code, 'decrypt.fetch');
  }
  applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
    state.completeDecryptFetch(fetchRes.data as DecryptFetchResponse);
  });

  const payload = fetchRes.data;
  let envelope: ReceiverKeyEnvelope | null;
  try {
    envelope = await deps.receiverKeyStorage.load(input.uuid);
  } catch (error) {
    return toError(toStorageErrorCode(error), 'decrypt.load-key');
  }
  if (!envelope) return toError('KEY_STORAGE_ERROR', 'decrypt.load-key', 'missing key');

  try {
    const { plaintext } = await performDecryptionPipeline(
      payload,
      input.passphrase,
      envelope,
      input.uuid
    );
    applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
      state.setPlaintext(plaintext);
    });

    return {
      ok: true,
      data: {
        plaintext,
        deliveredAt: payload.deliveredAt,
        receiverPubFpr: payload.receiverPubFpr,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'INTEGRITY_MISMATCH') {
      return toError('INTEGRITY_MISMATCH', 'decrypt.verify');
    }
    return toError('CRYPTO_ERROR', 'decrypt.crypto');
  }
}

/**
 * Creates and configures the main cryptographic orchestrator instance.
 */
export function createCryptoOrchestrator(deps: CryptoOrchestratorDeps = {}): CryptoOrchestrator {
  const resolved: ResolvedDeps = {
    client: deps.apiClient ?? defaultApiClient,
    receiverKeyStorage: deps.receiverKeyStorage ?? createIndexedDbReceiverKeyStorage(),
    softkeyAdminStorage: deps.softkeyAdminStorage ?? createIndexedDbSoftkeyAdminStorage(),
    pendingSoftkeyCleanupStorage:
      deps.pendingSoftkeyCleanupStorage ?? createIndexedDbPendingSoftkeyCleanupStorage(),
    createStore: deps.createStore ?? useCreateStore,
    lockStore: deps.lockStore ?? useLockStore,
    deliverStore: deps.deliverStore ?? useDeliverStore,
    decryptStore: deps.decryptStore ?? useDecryptStore,
    now: deps.now ?? (() => Date.now()),
    randomBytes:
      deps.randomBytes ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length))),
  };

  let createChannelQueue = Promise.resolve();

  return {
    createChannel: (input) => {
      const next = createChannelQueue.then(() => executeCreateChannel(resolved, input));
      createChannelQueue = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    lockChannel: (input) => executeLockChannel(resolved, input),
    deliverSecret: (input) => executeDeliverSecret(resolved, input),
    deleteChannel: (input) => executeDeleteChannel(resolved, input),
    decryptDelivered: (input) => executeDecryptDelivered(resolved, input),
  };
}

/**
 * Default singleton instance of the CryptoOrchestrator.
 */
let defaultCryptoOrchestrator: CryptoOrchestrator | null = null;

function getDefaultCryptoOrchestrator(): CryptoOrchestrator {
  if (!defaultCryptoOrchestrator) {
    defaultCryptoOrchestrator = createCryptoOrchestrator();
  }
  return defaultCryptoOrchestrator;
}

export const cryptoOrchestrator: CryptoOrchestrator = {
  createChannel: (input) => getDefaultCryptoOrchestrator().createChannel(input),
  lockChannel: (input) => getDefaultCryptoOrchestrator().lockChannel(input),
  deliverSecret: (input) => getDefaultCryptoOrchestrator().deliverSecret(input),
  deleteChannel: (input) => getDefaultCryptoOrchestrator().deleteChannel(input),
  decryptDelivered: (input) => getDefaultCryptoOrchestrator().decryptDelivered(input),
};
