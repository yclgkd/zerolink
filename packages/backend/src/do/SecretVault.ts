import {
  type AttestationJSON,
  type Base64Url,
  CHALLENGE_BYTES,
  CHALLENGE_TTL_MS,
  CHANNEL_STATE,
  CHANNEL_TTL_MS,
  type ChannelRecord,
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
  LockCommitRequestSchema,
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
import {
  assertNonTerminal,
  assertUuidMatch,
  assertWaitingState,
  jsonError,
  jsonResponse,
  mapError,
  methodNotAllowed,
  normalizeAssertion,
  notFound,
  readJsonBody,
} from './SecretVaultHttp.ts';
import { scheduleNextNonceCleanup, sweepExpiredNonces } from './SecretVaultNonces.ts';

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility (tests import from this module)
// ---------------------------------------------------------------------------

export { SecretVaultStateMachine } from './SecretVaultStateMachine.ts';
export type {
  CommitDeliveryParams,
  CommitLockChallengeParams,
  CommitLockParams,
  CompoundCommitParams,
  SecretVaultEnv,
  SoftkeyCompoundCommitParams,
  StoredCompoundChallenge,
  StoredLockChallenge,
  WebAuthnCompoundCommitParams,
} from './SecretVaultTypes.ts';
export {
  CHANNEL_RECORD_KEY,
  COMPOUND_CHALLENGE_KEY,
  CREATION_CHALLENGE_KEY,
  LOCK_CHALLENGE_KEY_PREFIX,
  lockChallengeStorageKey,
  NONCE_INDEX_KEY_PREFIX,
  NONCE_KEY_PREFIX,
  nonceIndexStorageKey,
  nonceStorageKey,
  StateTransitionError,
} from './SecretVaultTypes.ts';

import { SecretVaultStateMachine } from './SecretVaultStateMachine.ts';
import type {
  CommitDeliveryParams,
  CommitLockChallengeParams,
  CommitLockParams,
  CompoundCommitParams,
  SecretVaultEnv,
  StoredCompoundChallenge,
  StoredLockChallenge,
} from './SecretVaultTypes.ts';
import {
  CHANNEL_RECORD_KEY,
  COMPOUND_CHALLENGE_ID_BYTES,
  COMPOUND_CHALLENGE_KEY,
  CREATION_CHALLENGE_KEY,
  LOCK_CHALLENGE_ID_BYTES,
  lockChallengeStorageKey,
  nonceIndexStorageKey,
  nonceStorageKey,
  StateTransitionError,
} from './SecretVaultTypes.ts';

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
      return methodNotAllowed();
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

    if (url.pathname === '/get_public_state') {
      return this.handleGetPublicState();
    }

    if (url.pathname === '/get_decrypt_payload') {
      return this.handleGetDecryptPayload();
    }

    return notFound();
  }

  async alarm(now: number = Date.now()): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      await sweepExpiredNonces(this.ctx.storage, now);
      await scheduleNextNonceCleanup(this.ctx.storage, now);
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

      const expiresAt = asUnixMs(now + CHANNEL_TTL_MS.ONE_HOUR);
      const record: ChannelRecord = {
        uuid: uuid as UUID,
        state: CHANNEL_STATE.WAITING,
        createdAt: asUnixMs(now),
        expiresAt,
        ttl: CHANNEL_TTL_MS.ONE_HOUR,
        securityProfile,
        adminMode: 'webauthn',
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

  async commitCreate(params: {
    uuid: string;
    adminMode: 'webauthn' | 'softkey';
    attestation?: AttestationJSON;
    softkeyPubJwk?: ECDSAPublicKeyJWK;
    lockKeyB64u: Base64Url;
  }): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadRecord();
      assertUuidMatch(record.uuid, params.uuid);
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
            requireUserVerification: record.securityProfile !== 'standard',
          });
        } catch (err) {
          throw new StateTransitionError(
            'ATTESTATION_UNVERIFIABLE',
            err instanceof Error ? err.message : 'Attestation verification failed'
          );
        }

        if (record.securityProfile === 'hardware_only') {
          if (!verification.verified) {
            throw new StateTransitionError(
              'ATTESTATION_UNVERIFIABLE',
              'Hardware attestation could not be verified'
            );
          }
          const aaguidBytes = decodeBase64Url(verification.aaguid);
          if (aaguidBytes.every((b) => b === 0)) {
            throw new StateTransitionError(
              'ATTESTATION_UNVERIFIABLE',
              'Authenticator AAGUID is all zeros; hardware key identity could not be established'
            );
          }
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
      assertNonTerminal(record);
      assertUuidMatch(record.uuid, uuid);

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
      assertNonTerminal(record);
      assertUuidMatch(record.uuid, params.uuid);

      const { intent } = params;
      if (intent.uuid !== record.uuid) {
        throw new StateTransitionError('LOCK_FORBIDDEN', 'intent uuid mismatch');
      }

      if (intent.version !== record.version) {
        throw new StateTransitionError(
          'VERSION_MISMATCH',
          `expected version ${record.version}, got ${intent.version}`
        );
      }

      const skew = Math.abs(intent.timestamp - now);
      if (skew > TIMESTAMP_SKEW_MS) {
        throw new StateTransitionError(
          'TIMESTAMP_OUT_OF_RANGE',
          `timestamp skew ${skew}ms exceeds ${TIMESTAMP_SKEW_MS}ms`
        );
      }

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

      const computedHash = await computeIntentHash(intent as unknown as Record<string, unknown>);
      if (!constantTimeEqual(computedHash, params.intentHash)) {
        throw new StateTransitionError('INTENT_HASH_MISMATCH', 'intent hash does not match');
      }

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
      });
      await this.ensureNonceCleanupAlarm(nonceExpiresAt);

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

  async beginLockChallenge(
    uuid: string,
    now: number = Date.now()
  ): Promise<import('@zerolink/shared').LockChallenge> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadRecord();
      assertWaitingState(record);
      assertUuidMatch(record.uuid, uuid);

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
      assertWaitingState(record);
      assertUuidMatch(record.uuid, uuid);

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

      const expectedProof = await sha256Hex([
        toUtf8Bytes(DOMAIN.LOCK_PROOF),
        toUtf8Bytes(record.uuid),
        decodeBase64Url(challenge.id),
        decodeBase64Url(challenge.challenge),
        decodeBase64Url(record.lockKey),
      ]);
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

  private async loadLockChallenge(id: Base64Url): Promise<StoredLockChallenge | undefined> {
    return this.ctx.storage.get<StoredLockChallenge>(lockChallengeStorageKey(id));
  }

  private async saveLockChallenge(challenge: StoredLockChallenge): Promise<void> {
    await this.ctx.storage.put(lockChallengeStorageKey(challenge.id), challenge);
  }

  private async deleteLockChallenge(id: Base64Url): Promise<void> {
    await this.ctx.storage.delete(lockChallengeStorageKey(id));
  }

  private async handleCreateBegin(request: Request): Promise<Response> {
    const body = await readJsonBody(request);
    if (body === null) {
      return jsonError('BAD_REQUEST', 400);
    }

    const parsed = CreateBeginRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('BAD_REQUEST', 400);
    }

    try {
      const creationOptions = await this.beginCreate(parsed.data.uuid, parsed.data.securityProfile);
      return jsonResponse({ ok: true, creationOptions }, 200);
    } catch (error) {
      return mapError(error);
    }
  }

  private async handleCreateFinish(request: Request): Promise<Response> {
    const body = await readJsonBody(request);
    if (body === null) {
      return jsonError('BAD_REQUEST', 400);
    }

    const parsed = CreateFinishRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('BAD_REQUEST', 400);
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

      return jsonResponse(
        {
          ok: true,
          shareUrl: `${this.env.RP_ORIGIN}/s/${parsed.data.uuid}`,
          manageUrl: `${this.env.RP_ORIGIN}/m/${parsed.data.uuid}`,
        },
        200
      );
    } catch (error) {
      return mapError(error);
    }
  }

  private async handleLockBegin(request: Request): Promise<Response> {
    const body = await readJsonBody(request);
    if (body === null) {
      return jsonError('BAD_REQUEST', 400);
    }

    const parsed = LockBeginRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('BAD_REQUEST', 400);
    }

    try {
      const lockChallenge = await this.beginLockChallenge(parsed.data.uuid);
      return jsonResponse({ ok: true, lockChallenge }, 200);
    } catch (error) {
      return mapError(error);
    }
  }

  private async handleCompoundBegin(request: Request): Promise<Response> {
    const body = await readJsonBody(request);
    if (body === null) {
      return jsonError('BAD_REQUEST', 400);
    }

    const parsed = CompoundBeginRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('BAD_REQUEST', 400);
    }

    try {
      const result = await this.beginCompoundChallenge(parsed.data.uuid);
      return jsonResponse({ ok: true, ...result }, 200);
    } catch (error) {
      return mapError(error);
    }
  }

  private async handleCompoundCommit(request: Request): Promise<Response> {
    const body = await readJsonBody(request);
    if (body === null) {
      return jsonError('BAD_REQUEST', 400);
    }

    const parsedWebAuthn = CompoundCommitRequestSchema.safeParse(body);
    const parsedSoftkey = SoftkeyCompoundCommitRequestSchema.safeParse(body);
    if (!parsedWebAuthn.success && !parsedSoftkey.success) {
      return jsonError('BAD_REQUEST', 400);
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
          assertion: normalizeAssertion(parsedWebAuthn.data.assertion),
          intentHash: parsedWebAuthn.data.intentHash,
          intent: parsedWebAuthn.data.intent,
        });
      }

      return jsonResponse({ ok: true }, 200);
    } catch (error) {
      return mapError(error);
    }
  }

  private async handleLockCommit(request: Request): Promise<Response> {
    const body = await readJsonBody(request);
    if (body === null) {
      return jsonError('BAD_REQUEST', 400);
    }

    const parsed = LockCommitRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('BAD_REQUEST', 400);
    }

    try {
      // LockCommitRequest is structurally compatible with CommitLockChallengeParams
      await this.commitLockChallenge(parsed.data as unknown as CommitLockChallengeParams);
      return jsonResponse({ ok: true }, 200);
    } catch (error) {
      return mapError(error);
    }
  }

  private async handleGetPublicState(): Promise<Response> {
    try {
      const record = await this.loadRecord();
      const body: Record<string, unknown> = {
        ok: true,
        state: record.state,
        adminMode: record.adminMode,
      };
      if (record.receiver?.pubFpr) {
        body['receiverPubFpr'] = record.receiver.pubFpr;
      }
      return jsonResponse(body, 200);
    } catch (error) {
      return mapError(error);
    }
  }

  private async handleGetDecryptPayload(): Promise<Response> {
    try {
      const record = await this.loadRecord();
      if (
        record.state !== CHANNEL_STATE.DELIVERED ||
        !record.cipherBundle ||
        !record.receiver ||
        record.deliveredAt == null
      ) {
        return jsonError('CHANNEL_NOT_DELIVERED', 409);
      }
      return jsonResponse(
        {
          ok: true,
          cipherBundle: record.cipherBundle,
          receiverPubFpr: record.receiver.pubFpr,
          deliveredAt: record.deliveredAt,
        },
        200
      );
    } catch (error) {
      return mapError(error);
    }
  }
}
