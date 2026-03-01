import {
  type AssertionJSON,
  type AttestationJSON,
  type Base64Url,
  CHALLENGE_BYTES,
  CHALLENGE_TTL_MS,
  CHANNEL_STATE,
  type ChannelRecord,
  type CipherBundle,
  CompoundBeginRequestSchema,
  type CompoundChallenge,
  CompoundCommitRequestSchema,
  CreateBeginRequestSchema,
  CreateFinishRequestSchema,
  computeIntentHash,
  DOMAIN,
  type ECDSAPublicKeyJWK,
  type HexString,
  LockBeginRequestSchema,
  type LockChallenge,
  type LockCommitRequest,
  LockCommitRequestSchema,
  type ManageIntent,
  NONCE_TTL_MS,
  type NonceRecord,
  type RSAPublicKeyJWK,
  SoftkeyCompoundCommitRequestSchema,
  type SoftkeyCredential,
  type StoredCredential,
  TIMESTAMP_SKEW_MS,
  type UnixMs,
  type UUID,
} from '@zerolink/shared';
import { type AttestationVerificationResult, verifyAttestation } from '../crypto/attestation.ts';
import {
  asUnixMs,
  constantTimeEqual,
  decodeBase64Url,
  encodeBase64Url,
  getCryptoApi,
  sha256Bytes,
  sha256Hex,
  toUtf8Bytes,
} from '../crypto/bytes.ts';
import { verifySoftkeySignature } from '../crypto/softkey.ts';
import { generateCreationOptions, verifyAssertion } from '../crypto/webauthn.ts';

export interface SecretVaultEnv {
  SECRET_VAULT: DurableObjectNamespace;
  SECRETS_KV: KVNamespace;
  RP_ID: string;
  RP_ORIGIN: string;
}

export interface CommitLockParams {
  receiverPubJwk: RSAPublicKeyJWK;
  receiverPubFpr: HexString;
  lockedAt: UnixMs;
}

export interface CommitDeliveryParams {
  cipherBundle: CipherBundle;
  deliveredAt: UnixMs;
}

export interface CommitLockChallengeParams {
  uuid: string;
  lockChallengeId: Base64Url;
  lockProof: HexString;
  receiverPubJwk: RSAPublicKeyJWK;
  receiverPubFpr: HexString;
  lockedAt: UnixMs;
}

export interface WebAuthnCompoundCommitParams {
  adminMode?: 'webauthn';
  uuid: string;
  assertion: AssertionJSON;
  intentHash: HexString;
  intent: ManageIntent;
}

export interface SoftkeyCompoundCommitParams {
  adminMode: 'softkey';
  uuid: string;
  softkeySignature: HexString;
  intentHash: HexString;
  intent: ManageIntent;
}

export type CompoundCommitParams = WebAuthnCompoundCommitParams | SoftkeyCompoundCommitParams;

interface StoredLockChallenge {
  id: Base64Url;
  challenge: Base64Url;
  expiresAt: UnixMs;
  consumedAt?: UnixMs;
}

interface StoredCompoundChallenge {
  id: Base64Url;
  seed: Base64Url;
  expiresAt: UnixMs;
  consumedAt?: UnixMs;
}

interface NonceIndexRecord {
  nonce: Base64Url;
  expiresAt: UnixMs;
}

interface LooseAssertionJson {
  id: Base64Url;
  rawId: Base64Url;
  type: 'public-key';
  response: {
    clientDataJSON: Base64Url;
    authenticatorData: Base64Url;
    signature: Base64Url;
    userHandle?: Base64Url | null | undefined;
  };
}

interface ErrorResponse {
  ok: false;
  code: string;
}

interface MethodNotAllowedResponse extends ErrorResponse {
  code: 'METHOD_NOT_ALLOWED';
}

type StateTransitionErrorCode =
  | 'INVALID_TRANSITION'
  | 'TERMINAL_STATE'
  | 'RECORD_NOT_FOUND'
  | 'CHALLENGE_INVALID'
  | 'CHALLENGE_CONSUMED'
  | 'LOCK_FORBIDDEN'
  | 'VERSION_MISMATCH'
  | 'NONCE_REPLAY'
  | 'TIMESTAMP_OUT_OF_RANGE'
  | 'ASSERTION_INVALID'
  | 'INTENT_HASH_MISMATCH'
  | 'ATTESTATION_UNVERIFIABLE';

export class StateTransitionError extends Error {
  readonly code: StateTransitionErrorCode;

  constructor(code: StateTransitionErrorCode, message: string) {
    super(message);
    this.name = 'StateTransitionError';
    this.code = code;
  }
}

export const CHANNEL_RECORD_KEY = 'channel_record' as const;
export const CREATION_CHALLENGE_KEY = 'creation_challenge' as const;
export const LOCK_CHALLENGE_KEY_PREFIX = 'lock_challenge:' as const;
export const COMPOUND_CHALLENGE_KEY = 'compound_challenge_active' as const;
export const NONCE_KEY_PREFIX = 'nonce:' as const;
export const NONCE_INDEX_KEY_PREFIX = 'nonce_index:' as const;

const LOCK_CHALLENGE_ID_BYTES = 16;
const COMPOUND_CHALLENGE_ID_BYTES = 16;
const NONCE_INDEX_TIMESTAMP_WIDTH = 16;
const NONCE_SWEEP_BATCH_SIZE = 128;
const NONCE_SWEEP_RETRY_DELAY_MS = 1_000;

function lockChallengeStorageKey(id: Base64Url): string {
  return `${LOCK_CHALLENGE_KEY_PREFIX}${id}`;
}

function nonceStorageKey(nonce: Base64Url): string {
  return `${NONCE_KEY_PREFIX}${nonce}`;
}

function nonceIndexStorageKey(expiresAt: UnixMs, nonce: Base64Url): string {
  const paddedExpiresAt = String(expiresAt).padStart(NONCE_INDEX_TIMESTAMP_WIDTH, '0');
  return `${NONCE_INDEX_KEY_PREFIX}${paddedExpiresAt}:${nonce}`;
}

export class SecretVaultStateMachine {
  private readonly record: ChannelRecord;

  constructor(record: ChannelRecord) {
    this.record = record;
  }

  commitLock({ receiverPubJwk, receiverPubFpr, lockedAt }: CommitLockParams): ChannelRecord {
    if (
      this.record.state === CHANNEL_STATE.DELETED ||
      this.record.state === CHANNEL_STATE.EXPIRED
    ) {
      throw new StateTransitionError(
        'TERMINAL_STATE',
        `cannot lock when state is ${this.record.state}`
      );
    }

    if (this.record.state !== CHANNEL_STATE.WAITING) {
      throw new StateTransitionError(
        'INVALID_TRANSITION',
        `lock transition requires waiting state, got ${this.record.state}`
      );
    }

    return {
      ...this.record,
      state: CHANNEL_STATE.LOCKED,
      receiver: {
        pubJwk: receiverPubJwk,
        pubFpr: receiverPubFpr,
        lockedAt,
      },
    };
  }

  commitDelivery({ cipherBundle, deliveredAt }: CommitDeliveryParams): ChannelRecord {
    if (
      this.record.state === CHANNEL_STATE.DELETED ||
      this.record.state === CHANNEL_STATE.EXPIRED
    ) {
      throw new StateTransitionError(
        'TERMINAL_STATE',
        `cannot deliver when state is ${this.record.state}`
      );
    }

    if (
      this.record.state !== CHANNEL_STATE.LOCKED &&
      this.record.state !== CHANNEL_STATE.DELIVERED
    ) {
      throw new StateTransitionError(
        'INVALID_TRANSITION',
        `delivery transition requires locked or delivered state, got ${this.record.state}`
      );
    }

    return {
      ...this.record,
      state: CHANNEL_STATE.DELIVERED,
      cipherBundle,
      deliveredAt,
      version: this.record.version + 1,
    };
  }

  commitDelete(): ChannelRecord {
    if (
      this.record.state === CHANNEL_STATE.DELETED ||
      this.record.state === CHANNEL_STATE.EXPIRED
    ) {
      throw new StateTransitionError(
        'TERMINAL_STATE',
        `cannot delete when state is ${this.record.state}`
      );
    }

    return {
      ...this.record,
      state: CHANNEL_STATE.DELETED,
    };
  }

  expire(): ChannelRecord {
    if (
      this.record.state === CHANNEL_STATE.DELETED ||
      this.record.state === CHANNEL_STATE.EXPIRED
    ) {
      throw new StateTransitionError(
        'TERMINAL_STATE',
        `cannot expire when state is ${this.record.state}`
      );
    }

    return {
      ...this.record,
      state: CHANNEL_STATE.EXPIRED,
    };
  }
}

export class SecretVault {
  private readonly ctx: DurableObjectState;
  private readonly env: SecretVaultEnv;

  constructor(ctx: DurableObjectState, env: SecretVaultEnv) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST') {
      return this.methodNotAllowed();
    }

    if (url.pathname === '/create_begin') {
      return this.handleCreateBegin(request);
    }

    if (url.pathname === '/create_finish') {
      return this.handleCreateFinish(request);
    }

    if (url.pathname === '/lock_begin') {
      return this.handleLockBegin(request);
    }

    if (url.pathname === '/lock_commit') {
      return this.handleLockCommit(request);
    }

    if (url.pathname === '/compound_begin') {
      return this.handleCompoundBegin(request);
    }

    if (url.pathname === '/compound_commit') {
      return this.handleCompoundCommit(request);
    }

    return this.notFound();
  }

  async alarm(now: number = Date.now()): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.sweepExpiredNonces(now);
      await this.scheduleNextNonceCleanup(now);
    });
  }

  async initialize(record: ChannelRecord): Promise<ChannelRecord> {
    await this.saveRecord(record);
    return record;
  }

  async getRecord(): Promise<ChannelRecord> {
    return this.loadRecord();
  }

  async commitLock(params: CommitLockParams): Promise<ChannelRecord> {
    return this.applyTransition((machine) => machine.commitLock(params));
  }

  async commitDelivery(params: CommitDeliveryParams): Promise<ChannelRecord> {
    return this.applyTransition((machine) => machine.commitDelivery(params));
  }

  async commitDelete(): Promise<ChannelRecord> {
    return this.applyTransition((machine) => machine.commitDelete());
  }

  async expire(): Promise<ChannelRecord> {
    return this.applyTransition((machine) => machine.expire());
  }

  async beginCreate(
    uuid: string,
    securityProfile: ChannelRecord['securityProfile'],
    now: number = Date.now()
  ): Promise<Record<string, unknown>> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const existing = await this.ctx.storage.get<ChannelRecord>(CHANNEL_RECORD_KEY);
      if (existing) {
        throw new StateTransitionError('INVALID_TRANSITION', 'channel already exists');
      }

      const cryptoApi = getCryptoApi();
      const challenge = cryptoApi.getRandomValues(new Uint8Array(CHALLENGE_BYTES));

      // Save a "half-initialized" record or just store the challenge.
      // PRD says channel is created at create_begin.
      const expiresAt = asUnixMs(now + 3600000); // Default 1h for initialization
      const record: ChannelRecord = {
        uuid: uuid as UUID,
        state: CHANNEL_STATE.WAITING,
        createdAt: asUnixMs(now),
        expiresAt,
        ttl: 3600000,
        securityProfile,
        adminMode: 'webauthn', // Default, might be changed by create_finish
        adminCredential: {
          credentialId: '' as Base64Url,
          publicKey: '' as Base64Url,
          signCount: 0,
          aaguid: '' as Base64Url,
        },
        lockKey: '' as Base64Url,
        version: 0,
      };

      await this.saveRecord(record);
      // Store the creation challenge under a fixed key so commitCreate can
      // retrieve it without needing the random challenge id.
      await this.ctx.storage.put(CREATION_CHALLENGE_KEY, encodeBase64Url(challenge));

      return generateCreationOptions({
        rpId: this.env.RP_ID,
        rpName: 'ZeroLink',
        uuid,
        challenge,
        securityProfile,
      });
    });
  }

  async commitCreate(
    params: {
      uuid: string;
      adminMode: 'webauthn' | 'softkey';
      attestation?: AttestationJSON;
      softkeyPubJwk?: ECDSAPublicKeyJWK;
      lockKeyB64u: Base64Url;
    },
    _now: number = Date.now()
  ): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadRecord();
      this.assertUuidMatch(record.uuid, params.uuid);
      if (record.lockKey !== '') {
        throw new StateTransitionError('INVALID_TRANSITION', 'channel already finalized');
      }

      let adminCredential: StoredCredential | SoftkeyCredential;

      if (params.adminMode === 'softkey') {
        if (!params.softkeyPubJwk) {
          throw new StateTransitionError(
            'LOCK_FORBIDDEN',
            'softkeyPubJwk required for softkey mode'
          );
        }
        adminCredential = {
          type: 'softkey',
          softkeyPubJwk: params.softkeyPubJwk,
        };
      } else {
        if (!params.attestation) {
          throw new StateTransitionError(
            'LOCK_FORBIDDEN',
            'attestation required for webauthn mode'
          );
        }

        const storedChallenge = await this.ctx.storage.get<Base64Url>(CREATION_CHALLENGE_KEY);
        if (!storedChallenge) {
          throw new StateTransitionError('CHALLENGE_INVALID', 'creation challenge not found');
        }
        await this.ctx.storage.delete(CREATION_CHALLENGE_KEY);

        let verification: AttestationVerificationResult;
        try {
          verification = await verifyAttestation({
            attestationObjectB64u: params.attestation.response.attestationObject,
            clientDataJSONB64u: params.attestation.response.clientDataJSON,
            expectedRpId: this.env.RP_ID,
            expectedOrigin: this.env.RP_ORIGIN,
            expectedChallenge: decodeBase64Url(storedChallenge),
          });
        } catch (err) {
          throw new StateTransitionError(
            'ATTESTATION_UNVERIFIABLE',
            err instanceof Error ? err.message : 'Attestation verification failed'
          );
        }

        if (record.securityProfile === 'hardware_only' && !verification.verified) {
          throw new StateTransitionError(
            'ATTESTATION_UNVERIFIABLE',
            'Hardware attestation could not be verified'
          );
        }

        adminCredential = {
          credentialId: verification.credentialId,
          publicKey: verification.publicKey,
          signCount: verification.signCount,
          aaguid: verification.aaguid,
          ...(verification.transports ? { transports: verification.transports } : {}),
        };
      }

      // biome-ignore lint/suspicious/noExplicitAny: transports mismatch between DOM and shared types
      const updatedRecord: any = {
        ...record,
        adminMode: params.adminMode,
        adminCredential,
        lockKey: params.lockKeyB64u,
      };

      await this.saveRecord(updatedRecord as ChannelRecord);
    });
  }

  async beginCompoundChallenge(
    uuid: string,
    now: number = Date.now()
  ): Promise<{
    challenge: CompoundChallenge;
    receiverPubFpr?: HexString;
    receiverPubJwk?: RSAPublicKeyJWK;
    currentVersion: number;
    adminMode: ChannelRecord['adminMode'];
  }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadRecord();
      this.assertNonTerminal(record);
      this.assertUuidMatch(record.uuid, uuid);

      const cryptoApi = getCryptoApi();
      const id = encodeBase64Url(
        cryptoApi.getRandomValues(new Uint8Array(COMPOUND_CHALLENGE_ID_BYTES))
      );
      const seed = encodeBase64Url(cryptoApi.getRandomValues(new Uint8Array(CHALLENGE_BYTES)));
      const expiresAt = asUnixMs(now + CHALLENGE_TTL_MS);
      const stored: StoredCompoundChallenge = { id, seed, expiresAt };

      await this.ctx.storage.put(COMPOUND_CHALLENGE_KEY, stored);

      const response: {
        challenge: CompoundChallenge;
        currentVersion: number;
        receiverPubFpr?: HexString;
        receiverPubJwk?: RSAPublicKeyJWK;
        adminMode: ChannelRecord['adminMode'];
      } = {
        challenge: {
          id: stored.id,
          seed: stored.seed,
          expiresAt: stored.expiresAt,
        },
        currentVersion: record.version,
        adminMode: record.adminMode,
      };
      if (record.receiver) {
        response.receiverPubFpr = record.receiver.pubFpr;
        response.receiverPubJwk = record.receiver.pubJwk;
      }

      return response;
    });
  }

  async commitCompound(params: CompoundCommitParams, now: number = Date.now()): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadRecord();
      this.assertNonTerminal(record);
      this.assertUuidMatch(record.uuid, params.uuid);

      const { intent } = params;
      if (intent.uuid !== record.uuid) {
        throw new StateTransitionError('LOCK_FORBIDDEN', 'intent uuid mismatch');
      }

      // Version check
      if (intent.version !== record.version) {
        throw new StateTransitionError(
          'VERSION_MISMATCH',
          `expected version ${record.version}, got ${intent.version}`
        );
      }

      // Timestamp skew check
      const skew = Math.abs(intent.timestamp - now);
      if (skew > TIMESTAMP_SKEW_MS) {
        throw new StateTransitionError(
          'TIMESTAMP_OUT_OF_RANGE',
          `timestamp skew ${skew}ms exceeds ${TIMESTAMP_SKEW_MS}ms`
        );
      }

      // Nonce replay check
      const nonceKey = nonceStorageKey(intent.nonce);
      const existingNonce = await this.ctx.storage.get<NonceRecord>(nonceKey);
      if (existingNonce) {
        if (existingNonce.expiresAt > now) {
          throw new StateTransitionError('NONCE_REPLAY', 'nonce already consumed');
        }

        await this.ctx.storage.delete([
          nonceKey,
          nonceIndexStorageKey(existingNonce.expiresAt, existingNonce.nonce),
        ]);
      }

      // Intent hash verification
      const computedHash = await computeIntentHash(intent as unknown as Record<string, unknown>);
      if (!constantTimeEqual(computedHash, params.intentHash)) {
        throw new StateTransitionError('INTENT_HASH_MISMATCH', 'intent hash does not match');
      }

      // Load and validate compound challenge
      const challenge = await this.ctx.storage.get<StoredCompoundChallenge>(COMPOUND_CHALLENGE_KEY);
      if (!challenge) {
        throw new StateTransitionError('CHALLENGE_INVALID', 'compound challenge not found');
      }
      if (challenge.consumedAt !== undefined) {
        throw new StateTransitionError('CHALLENGE_CONSUMED', 'compound challenge already consumed');
      }
      if (challenge.expiresAt <= now) {
        await this.ctx.storage.delete(COMPOUND_CHALLENGE_KEY);
        throw new StateTransitionError('CHALLENGE_INVALID', 'compound challenge expired');
      }

      // Derive expected challenge:
      // SHA-256("GLv2.5" || uuid || challengeId || intentHash || seed)
      const expectedChallengeBytes = await sha256Bytes([
        toUtf8Bytes(DOMAIN.CHALLENGE),
        toUtf8Bytes(record.uuid),
        decodeBase64Url(challenge.id),
        toUtf8Bytes(params.intentHash),
        decodeBase64Url(challenge.seed),
      ]);

      let verifiedWebAuthnSignCount: number | null = null;

      if (record.adminMode === 'softkey') {
        if (params.adminMode !== 'softkey' || !('softkeySignature' in params)) {
          throw new StateTransitionError(
            'ASSERTION_INVALID',
            'softkey commit payload required for softkey channel'
          );
        }

        const verifyResult = await verifySoftkeySignature({
          softkeyPubJwk: (record.adminCredential as SoftkeyCredential).softkeyPubJwk,
          payload: expectedChallengeBytes,
          signatureHex: params.softkeySignature,
        });
        if (!verifyResult.ok) {
          throw new StateTransitionError('ASSERTION_INVALID', verifyResult.error);
        }
      } else {
        if ('adminMode' in params && params.adminMode === 'softkey') {
          throw new StateTransitionError(
            'ASSERTION_INVALID',
            'webauthn commit payload required for webauthn channel'
          );
        }

        const verifyResult = await verifyAssertion({
          assertion: params.assertion,
          expectedChallenge: encodeBase64Url(expectedChallengeBytes),
          storedCredential: record.adminCredential as StoredCredential,
          rpId: this.env.RP_ID,
          rpOrigin: this.env.RP_ORIGIN,
        });
        if (!verifyResult.ok) {
          throw new StateTransitionError('ASSERTION_INVALID', verifyResult.error);
        }
        verifiedWebAuthnSignCount = verifyResult.newSignCount;
      }

      // Apply state transition
      const machine = new SecretVaultStateMachine(record);
      let nextRecord: ChannelRecord;
      if (intent.op === 'delete') {
        nextRecord = machine.commitDelete();
      } else {
        nextRecord = machine.commitDelivery({
          cipherBundle: intent.cipherBundle,
          deliveredAt: intent.timestamp,
        });
      }

      // Store nonce with TTL and track it in a sweep-friendly index.
      const nonceExpiresAt = asUnixMs(now + NONCE_TTL_MS);
      const nonceRecord: NonceRecord = {
        nonce: intent.nonce,
        usedAt: asUnixMs(now),
        expiresAt: nonceExpiresAt,
      };
      await this.ctx.storage.put(nonceKey, nonceRecord);
      await this.ctx.storage.put(nonceIndexStorageKey(nonceExpiresAt, intent.nonce), {
        nonce: intent.nonce,
        expiresAt: nonceExpiresAt,
      } satisfies NonceIndexRecord);
      await this.ensureNonceCleanupAlarm(nonceExpiresAt);

      // Mark challenge consumed
      await this.ctx.storage.put(COMPOUND_CHALLENGE_KEY, {
        ...challenge,
        consumedAt: asUnixMs(now),
      });

      const updatedRecord: ChannelRecord =
        verifiedWebAuthnSignCount === null
          ? nextRecord
          : {
              ...nextRecord,
              adminCredential: {
                ...(nextRecord.adminCredential as StoredCredential),
                signCount: verifiedWebAuthnSignCount,
              },
            };

      await this.saveRecord(updatedRecord);
    });
  }

  async beginLockChallenge(uuid: string, now: number = Date.now()): Promise<LockChallenge> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadRecord();
      this.assertWaitingState(record);
      this.assertUuidMatch(record.uuid, uuid);

      const cryptoApi = getCryptoApi();
      const id = encodeBase64Url(
        cryptoApi.getRandomValues(new Uint8Array(LOCK_CHALLENGE_ID_BYTES))
      );
      const challenge = encodeBase64Url(cryptoApi.getRandomValues(new Uint8Array(CHALLENGE_BYTES)));
      const expiresAt = asUnixMs(now + CHALLENGE_TTL_MS);
      const stored: StoredLockChallenge = { id, challenge, expiresAt };

      await this.saveLockChallenge(stored);
      return {
        id: stored.id,
        challenge: stored.challenge,
        expiresAt: stored.expiresAt,
      };
    });
  }

  async commitLockChallenge(
    {
      uuid,
      lockChallengeId,
      lockProof,
      receiverPubJwk,
      receiverPubFpr,
      lockedAt,
    }: CommitLockChallengeParams,
    now: number = Date.now()
  ): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadRecord();
      this.assertWaitingState(record);
      this.assertUuidMatch(record.uuid, uuid);

      const challenge = await this.loadLockChallenge(lockChallengeId);
      if (!challenge) {
        throw new StateTransitionError('CHALLENGE_INVALID', 'lock challenge not found');
      }
      if (challenge.consumedAt !== undefined) {
        throw new StateTransitionError('CHALLENGE_CONSUMED', 'lock challenge already consumed');
      }
      if (challenge.expiresAt <= now) {
        await this.deleteLockChallenge(lockChallengeId);
        throw new StateTransitionError('CHALLENGE_INVALID', 'lock challenge expired');
      }

      const expectedProof = await this.computeExpectedLockProof(record, challenge);
      if (!constantTimeEqual(expectedProof, lockProof)) {
        throw new StateTransitionError('LOCK_FORBIDDEN', 'lock proof mismatch');
      }

      await this.saveLockChallenge({
        ...challenge,
        consumedAt: asUnixMs(now),
      });
      const nextRecord = new SecretVaultStateMachine(record).commitLock({
        receiverPubJwk,
        receiverPubFpr,
        lockedAt,
      });
      await this.saveRecord(nextRecord);
    });
  }

  private async applyTransition(
    transition: (machine: SecretVaultStateMachine) => ChannelRecord
  ): Promise<ChannelRecord> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.loadRecord();
      const next = transition(new SecretVaultStateMachine(current));
      await this.saveRecord(next);
      return next;
    });
  }

  private async ensureNonceCleanupAlarm(expiresAt: UnixMs): Promise<void> {
    const scheduledAt = await this.ctx.storage.getAlarm();
    const targetAt = Number(expiresAt);
    if (scheduledAt === null || scheduledAt > targetAt) {
      await this.ctx.storage.setAlarm(targetAt);
    }
  }

  private async sweepExpiredNonces(now: number): Promise<void> {
    const nonceIndexes = await this.ctx.storage.list<NonceIndexRecord>({
      prefix: NONCE_INDEX_KEY_PREFIX,
      limit: NONCE_SWEEP_BATCH_SIZE,
    });
    if (nonceIndexes.size === 0) {
      return;
    }

    const keysToDelete: string[] = [];
    for (const [indexKey, indexRecord] of nonceIndexes) {
      const resolved = this.resolveNonceIndexEntry(indexKey, indexRecord);
      if (!resolved) {
        keysToDelete.push(indexKey);
        continue;
      }
      if (resolved.expiresAt > now) {
        break;
      }

      keysToDelete.push(indexKey, nonceStorageKey(resolved.nonce));
    }

    if (keysToDelete.length > 0) {
      await this.ctx.storage.delete(keysToDelete);
    }
  }

  private async scheduleNextNonceCleanup(now: number): Promise<void> {
    while (true) {
      const firstEntry = await this.readEarliestNonceIndexEntry();
      if (!firstEntry) {
        await this.ctx.storage.deleteAlarm();
        return;
      }

      const [indexKey, indexRecord] = firstEntry;
      const resolved = this.resolveNonceIndexEntry(indexKey, indexRecord);
      if (!resolved) {
        await this.ctx.storage.delete(indexKey);
        continue;
      }

      const nextAlarmAt =
        resolved.expiresAt <= now ? now + NONCE_SWEEP_RETRY_DELAY_MS : resolved.expiresAt;
      await this.ctx.storage.setAlarm(nextAlarmAt);
      return;
    }
  }

  private async readEarliestNonceIndexEntry(): Promise<
    [string, NonceIndexRecord | undefined] | undefined
  > {
    const nonceIndexes = await this.ctx.storage.list<NonceIndexRecord>({
      prefix: NONCE_INDEX_KEY_PREFIX,
      limit: 1,
    });
    const firstEntry = nonceIndexes.entries().next().value;
    if (!firstEntry) {
      return undefined;
    }

    return [firstEntry[0], firstEntry[1]];
  }

  private resolveNonceIndexEntry(
    indexKey: string,
    indexRecord: NonceIndexRecord | undefined
  ): { nonce: Base64Url; expiresAt: number } | undefined {
    if (
      indexRecord &&
      typeof indexRecord.nonce === 'string' &&
      Number.isFinite(indexRecord.expiresAt)
    ) {
      return {
        nonce: indexRecord.nonce,
        expiresAt: Number(indexRecord.expiresAt),
      };
    }

    const suffix = indexKey.slice(NONCE_INDEX_KEY_PREFIX.length);
    const separator = suffix.indexOf(':');
    if (separator <= 0 || separator === suffix.length - 1) {
      return undefined;
    }

    const expiresAt = Number.parseInt(suffix.slice(0, separator), 10);
    if (!Number.isFinite(expiresAt)) {
      return undefined;
    }

    return {
      nonce: suffix.slice(separator + 1) as Base64Url,
      expiresAt,
    };
  }

  private async loadRecord(): Promise<ChannelRecord> {
    const record = await this.ctx.storage.get<ChannelRecord>(CHANNEL_RECORD_KEY);
    if (!record) {
      throw new StateTransitionError('RECORD_NOT_FOUND', 'channel record not initialized');
    }
    return record;
  }

  private async saveRecord(record: ChannelRecord): Promise<void> {
    await this.ctx.storage.put(CHANNEL_RECORD_KEY, record);
  }

  private methodNotAllowed(): Response {
    return this.jsonResponse<MethodNotAllowedResponse>(
      {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
      },
      405,
      {
        Allow: 'POST',
      }
    );
  }

  private notFound(): Response {
    return this.jsonError('NOT_FOUND', 404);
  }

  private jsonError(code: string, status: number): Response {
    return this.jsonResponse<ErrorResponse>(
      {
        ok: false,
        code,
      },
      status
    );
  }

  private jsonResponse<T extends object>(
    payload: T,
    status: number,
    extraHeaders?: HeadersInit
  ): Response {
    const headers = new Headers(extraHeaders);
    headers.set('Content-Type', 'application/json; charset=utf-8');

    return new Response(JSON.stringify(payload), {
      status,
      headers,
    });
  }

  private async handleCreateBegin(request: Request): Promise<Response> {
    const body = await this.readJsonBody(request);
    if (body === null) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    const parsed = CreateBeginRequestSchema.safeParse(body);
    if (!parsed.success) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    try {
      const creationOptions = await this.beginCreate(parsed.data.uuid, parsed.data.securityProfile);
      return this.jsonResponse(
        {
          ok: true,
          creationOptions,
        },
        200
      );
    } catch (error) {
      return this.mapError(error);
    }
  }

  private async handleCreateFinish(request: Request): Promise<Response> {
    const body = await this.readJsonBody(request);
    if (body === null) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    const parsed = CreateFinishRequestSchema.safeParse(body);
    if (!parsed.success) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    try {
      // biome-ignore lint/suspicious/noExplicitAny: complex union schema mismatch
      const commitParams: any = {
        uuid: parsed.data.uuid,
        adminMode: parsed.data.adminMode,
        attestation: parsed.data.adminMode === 'webauthn' ? parsed.data.attestation : undefined,
        softkeyPubJwk:
          parsed.data.adminMode === 'softkey'
            ? // biome-ignore lint/suspicious/noExplicitAny: Discriminated union narrowing in ternary
              (parsed.data as any).softkeyPubJwk
            : undefined,
        lockKeyB64u: parsed.data.lockKeyB64u,
      };
      await this.commitCreate(commitParams);

      return this.jsonResponse(
        {
          ok: true,
          shareUrl: `${this.env.RP_ORIGIN}/s/${parsed.data.uuid}`,
          manageUrl: `${this.env.RP_ORIGIN}/m/${parsed.data.uuid}`,
        },
        200
      );
    } catch (error) {
      return this.mapError(error);
    }
  }

  private async handleLockBegin(request: Request): Promise<Response> {
    const body = await this.readJsonBody(request);
    if (body === null) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    const parsed = LockBeginRequestSchema.safeParse(body);
    if (!parsed.success) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    try {
      const lockChallenge = await this.beginLockChallenge(parsed.data.uuid);
      return this.jsonResponse(
        {
          ok: true,
          lockChallenge,
        },
        200
      );
    } catch (error) {
      return this.mapError(error);
    }
  }

  private async handleCompoundBegin(request: Request): Promise<Response> {
    const body = await this.readJsonBody(request);
    if (body === null) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    const parsed = CompoundBeginRequestSchema.safeParse(body);
    if (!parsed.success) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    try {
      const result = await this.beginCompoundChallenge(parsed.data.uuid);
      return this.jsonResponse({ ok: true, ...result }, 200);
    } catch (error) {
      return this.mapError(error);
    }
  }

  private async handleCompoundCommit(request: Request): Promise<Response> {
    const body = await this.readJsonBody(request);
    if (body === null) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    const parsedWebAuthn = CompoundCommitRequestSchema.safeParse(body);
    const parsedSoftkey = SoftkeyCompoundCommitRequestSchema.safeParse(body);
    if (!parsedWebAuthn.success && !parsedSoftkey.success) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    try {
      if (parsedSoftkey.success) {
        await this.commitCompound({
          adminMode: 'softkey',
          uuid: parsedSoftkey.data.uuid,
          softkeySignature: parsedSoftkey.data.softkeySignature,
          intentHash: parsedSoftkey.data.intentHash,
          intent: parsedSoftkey.data.intent,
        });
      } else if (parsedWebAuthn.success) {
        await this.commitCompound({
          uuid: parsedWebAuthn.data.uuid,
          assertion: this.normalizeAssertion(parsedWebAuthn.data.assertion),
          intentHash: parsedWebAuthn.data.intentHash,
          intent: parsedWebAuthn.data.intent,
        });
      }

      return this.jsonResponse({ ok: true }, 200);
    } catch (error) {
      return this.mapError(error);
    }
  }

  private async handleLockCommit(request: Request): Promise<Response> {
    const body = await this.readJsonBody(request);
    if (body === null) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    const parsed = LockCommitRequestSchema.safeParse(body);
    if (!parsed.success) {
      return this.jsonError('BAD_REQUEST', 400);
    }

    try {
      await this.commitLockChallenge(this.toCommitLockChallengeParams(parsed.data));
      return this.jsonResponse({ ok: true }, 200);
    } catch (error) {
      return this.mapError(error);
    }
  }

  private async readJsonBody(request: Request): Promise<unknown | null> {
    try {
      return await request.json();
    } catch {
      return null;
    }
  }

  private toCommitLockChallengeParams(request: LockCommitRequest): CommitLockChallengeParams {
    return {
      uuid: request.uuid,
      lockChallengeId: request.lockChallengeId,
      lockProof: request.lockProof,
      receiverPubJwk: request.receiverPubJwk,
      receiverPubFpr: request.receiverPubFpr,
      lockedAt: request.lockedAt,
    };
  }

  private normalizeAssertion(assertion: LooseAssertionJson): AssertionJSON {
    const { userHandle, ...restResponse } = assertion.response;

    if (userHandle === undefined) {
      return {
        ...assertion,
        response: restResponse,
      };
    }

    return {
      ...assertion,
      response: {
        ...restResponse,
        userHandle,
      },
    };
  }

  private mapError(error: unknown): Response {
    if (error instanceof StateTransitionError) {
      return this.mapStateTransitionError(error);
    }

    return this.jsonError('INTERNAL_ERROR', 500);
  }

  private mapStateTransitionError(error: StateTransitionError): Response {
    if (error.code === 'RECORD_NOT_FOUND') {
      return this.jsonError('NOT_FOUND', 404);
    }
    if (error.code === 'CHALLENGE_INVALID') {
      return this.jsonError('CHALLENGE_INVALID', 401);
    }
    if (error.code === 'CHALLENGE_CONSUMED') {
      return this.jsonError('CHALLENGE_CONSUMED', 409);
    }
    if (
      error.code === 'LOCK_FORBIDDEN' ||
      error.code === 'INVALID_TRANSITION' ||
      error.code === 'TERMINAL_STATE'
    ) {
      return this.jsonError('LOCK_FORBIDDEN', 403);
    }
    if (error.code === 'VERSION_MISMATCH' || error.code === 'NONCE_REPLAY') {
      return this.jsonError(error.code, 409);
    }
    if (error.code === 'TIMESTAMP_OUT_OF_RANGE' || error.code === 'INTENT_HASH_MISMATCH') {
      return this.jsonError(error.code, 400);
    }
    if (error.code === 'ASSERTION_INVALID') {
      return this.jsonError('ASSERTION_INVALID', 403);
    }
    if (error.code === 'ATTESTATION_UNVERIFIABLE') {
      return this.jsonError('ATTESTATION_UNVERIFIABLE', 403);
    }

    return this.jsonError('INTERNAL_ERROR', 500);
  }

  private assertNonTerminal(record: ChannelRecord): void {
    if (record.state === CHANNEL_STATE.DELETED || record.state === CHANNEL_STATE.EXPIRED) {
      throw new StateTransitionError(
        'TERMINAL_STATE',
        `operation forbidden for terminal state ${record.state}`
      );
    }
  }

  private assertWaitingState(record: ChannelRecord): void {
    if (record.state === CHANNEL_STATE.DELETED || record.state === CHANNEL_STATE.EXPIRED) {
      throw new StateTransitionError(
        'TERMINAL_STATE',
        `lock challenge flow forbidden for terminal state ${record.state}`
      );
    }
    if (record.state !== CHANNEL_STATE.WAITING) {
      throw new StateTransitionError(
        'INVALID_TRANSITION',
        `lock challenge flow requires waiting state, got ${record.state}`
      );
    }
  }

  private assertUuidMatch(recordUuid: string, requestUuid: string): void {
    if (recordUuid !== requestUuid) {
      throw new StateTransitionError('LOCK_FORBIDDEN', 'uuid mismatch');
    }
  }

  private async computeExpectedLockProof(
    record: ChannelRecord,
    challenge: StoredLockChallenge
  ): Promise<HexString> {
    return sha256Hex([
      toUtf8Bytes(DOMAIN.LOCK_PROOF),
      toUtf8Bytes(record.uuid),
      decodeBase64Url(challenge.id),
      decodeBase64Url(challenge.challenge),
      decodeBase64Url(record.lockKey),
    ]);
  }

  private async loadLockChallenge(id: Base64Url): Promise<StoredLockChallenge | undefined> {
    return this.ctx.storage.get<StoredLockChallenge>(lockChallengeStorageKey(id));
  }

  private async saveLockChallenge(challenge: StoredLockChallenge): Promise<void> {
    await this.ctx.storage.put(lockChallengeStorageKey(challenge.id), challenge);
  }

  private async deleteLockChallenge(id: Base64Url): Promise<void> {
    await this.ctx.storage.delete(lockChallengeStorageKey(id));
  }
}
