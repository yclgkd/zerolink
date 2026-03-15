import {
  type AttestationJSON,
  type Base64Url,
  buildCipherBundleAadBytes,
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
  type UpdateIntent,
  type UUID,
  WS_CLOSE_CHANNEL_GONE,
} from '@zerolink/shared';
import {
  appendInternalCommitCookieSignal,
  COMMIT_TOKEN_MODE,
  type CommitCookieKind,
  type CommitCookieSignal,
  createCommitToken,
  hashCommitToken,
  INTERNAL_CALLER_KEY_HEADER,
  INTERNAL_COMMIT_TOKEN_HEADER,
  verifyCommitToken,
} from '../commitTokens.ts';
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
import { type NonceAlarmState, reconcileNonceAlarmState } from './SecretVaultNonces.ts';
import {
  acceptWebSocket,
  broadcastToWebSockets,
  buildStateChangedMessage,
  handleWebSocketClose,
  handleWebSocketError,
  handleWebSocketMessage,
} from './SecretVaultWebSocket.ts';

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
  StoredTerminalTombstone,
  WebAuthnCompoundCommitParams,
} from './SecretVaultTypes.ts';
export {
  CHANNEL_RECORD_KEY,
  COMPOUND_CHALLENGE_KEY,
  CREATION_CHALLENGE_KEY,
  LOCK_CHALLENGE_KEY,
  NONCE_INDEX_KEY_PREFIX,
  NONCE_KEY_PREFIX,
  nonceIndexStorageKey,
  nonceStorageKey,
  RateLimitError,
  StateTransitionError,
  TERMINAL_TOMBSTONE_KEY,
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
  StoredTerminalTombstone,
} from './SecretVaultTypes.ts';
import {
  CHANNEL_RECORD_KEY,
  COMPOUND_CHALLENGE_ID_BYTES,
  COMPOUND_CHALLENGE_KEY,
  CREATION_CHALLENGE_KEY,
  LOCK_CHALLENGE_ID_BYTES,
  LOCK_CHALLENGE_KEY,
  NONCE_INDEX_KEY_PREFIX,
  NONCE_KEY_PREFIX,
  nonceIndexStorageKey,
  nonceStorageKey,
  RateLimitError,
  StateTransitionError,
  TERMINAL_TOMBSTONE_KEY,
} from './SecretVaultTypes.ts';

type RateLimitedEndpoint = 'lock_begin' | 'lock_commit' | 'compound_begin' | 'compound_commit';

interface RateLimitWindow {
  count: number;
  windowStart: number;
}

interface BeginRequestContext {
  callerKey: Base64Url | undefined;
}

interface CommitRequestContext extends BeginRequestContext {
  commitToken: string | undefined;
}

type LockChallengeStorageLocation = 'fixed' | 'legacy';

interface ResolvedLockChallenge {
  challenge: StoredLockChallenge;
  location: LockChallengeStorageLocation;
}

class CommitCookieStateTransitionError extends StateTransitionError {
  readonly commitCookieSignal: CommitCookieSignal;

  constructor(
    code: StateTransitionError['code'],
    message: string,
    commitCookieSignal: CommitCookieSignal
  ) {
    super(code, message);
    this.name = 'CommitCookieStateTransitionError';
    this.commitCookieSignal = commitCookieSignal;
  }
}

const RATE_LIMITS: Record<RateLimitedEndpoint, { maxRequests: number; windowMs: number }> = {
  lock_begin: { maxRequests: 3, windowMs: 60_000 },
  lock_commit: { maxRequests: 5, windowMs: 60_000 },
  compound_begin: { maxRequests: 3, windowMs: 60_000 },
  compound_commit: { maxRequests: 10, windowMs: 60_000 },
};

const LEGACY_LOCK_CHALLENGE_KEY_PREFIX = 'lock_challenge:' as const;

export class SecretVault {
  private readonly ctx: DurableObjectState;
  private readonly env: SecretVaultEnv;
  private readonly rateLimitWindows = new Map<string, RateLimitWindow>();

  constructor(ctx: DurableObjectState, env: SecretVaultEnv) {
    this.ctx = ctx;
    this.env = env;

    // L-3: Validate RP_ID and RP_ORIGIN at construction time
    if (!env.RP_ID || typeof env.RP_ID !== 'string') {
      throw new Error('RP_ID environment variable is missing or empty');
    }
    if (!env.RP_ORIGIN || typeof env.RP_ORIGIN !== 'string' || !env.RP_ORIGIN.startsWith('http')) {
      throw new Error(
        'RP_ORIGIN environment variable is missing or malformed (must start with http)'
      );
    }
    if (!env.COMMIT_TOKEN_SECRET || typeof env.COMMIT_TOKEN_SECRET !== 'string') {
      throw new Error('COMMIT_TOKEN_SECRET environment variable is missing or empty');
    }
  }

  private enforceRateLimit(
    endpoint: RateLimitedEndpoint,
    now: number,
    subjectKey: string = 'shared'
  ): void {
    const { maxRequests, windowMs } = RATE_LIMITS[endpoint];
    const bucketKey = `${endpoint}:${subjectKey}`;
    const existing = this.rateLimitWindows.get(bucketKey);

    if (!existing || now - existing.windowStart >= windowMs) {
      this.rateLimitWindows.set(bucketKey, { count: 1, windowStart: now });
      return;
    }

    if (existing.count >= maxRequests) {
      const retryAfterSeconds = (existing.windowStart + windowMs - now) / 1000;
      throw new RateLimitError(retryAfterSeconds, `${endpoint} rate limit exceeded`);
    }

    existing.count += 1;
  }

  // ─── Hibernation API WebSocket handlers ───────────────────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const record = await this.tryLoadActiveRecord();
    handleWebSocketMessage(ws, message, record);
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    handleWebSocketClose(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    handleWebSocketError(ws);
  }

  async fetch(request: Request): Promise<Response> {
    let handler = 'fetch';

    try {
      const url = new URL(request.url);

      // Handle WebSocket upgrade before method check
      if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
        handler = 'ws_subscribe';
        const record = await this.tryLoadActiveRecord();
        if (!record) {
          return notFound();
        }
        return acceptWebSocket(this.ctx);
      }

      if (request.method !== 'POST') {
        handler = 'method_not_allowed';
        return methodNotAllowed();
      }

      if (url.pathname === '/create_begin') {
        handler = 'create_begin';
        return this.handleCreateBegin(request);
      }

      if (url.pathname === '/create_finish') {
        handler = 'create_finish';
        return this.handleCreateFinish(request);
      }

      if (url.pathname === '/lock_begin') {
        handler = 'lock_begin';
        return this.handleLockBegin(request);
      }

      if (url.pathname === '/lock_commit') {
        handler = 'lock_commit';
        return this.handleLockCommit(request);
      }

      if (url.pathname === '/compound_begin') {
        handler = 'compound_begin';
        return this.handleCompoundBegin(request);
      }

      if (url.pathname === '/compound_commit') {
        handler = 'compound_commit';
        return this.handleCompoundCommit(request);
      }

      if (url.pathname === '/get_public_state') {
        handler = 'get_public_state';
        return this.handleGetPublicState();
      }

      if (url.pathname === '/get_decrypt_payload') {
        handler = 'get_decrypt_payload';
        return this.handleGetDecryptPayload();
      }

      handler = 'not_found';
      return notFound();
    } catch (error) {
      return mapError(error, { appEnv: this.env.APP_ENV, handler });
    }
  }

  async alarm(now: number = Date.now()): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.scheduleNextAlarm(now);
    });
  }

  async initialize(record: ChannelRecord): Promise<ChannelRecord> {
    await this.saveRecord(record);
    await this.scheduleNextAlarm(Number(record.createdAt));
    return record;
  }

  async getRecord(): Promise<ChannelRecord> {
    return this.loadActiveRecord();
  }

  async commitLock(params: CommitLockParams): Promise<ChannelRecord> {
    return this.applyTransition((machine) => machine.commitLock(params));
  }

  async commitDelivery(params: CommitDeliveryParams): Promise<ChannelRecord> {
    return this.applyTransition((machine) => machine.commitDelivery(params));
  }

  async commitDelete(): Promise<ChannelRecord> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.loadActiveRecord();
      const next = new SecretVaultStateMachine(current).commitDelete();
      await this.finalizeTerminalState(current.uuid, 'deleted');
      return next;
    });
  }

  async expire(): Promise<ChannelRecord> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.loadActiveRecord();
      const next = new SecretVaultStateMachine(current).expire();
      await this.finalizeTerminalState(current.uuid, 'expired');
      return next;
    });
  }

  async beginCreate(
    uuid: string,
    securityProfile: ChannelRecord['securityProfile'],
    now: number = Date.now()
  ): Promise<Record<string, unknown>> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const tombstone = await this.ctx.storage.get<StoredTerminalTombstone>(TERMINAL_TOMBSTONE_KEY);
      if (tombstone) {
        throw new StateTransitionError('INVALID_TRANSITION', 'channel already exists');
      }

      const existing = await this.ctx.storage.get<ChannelRecord>(CHANNEL_RECORD_KEY);
      if (existing) {
        if (this.shouldPurgeRecord(existing, now)) {
          await this.finalizeTerminalRecord(existing, now);
        }
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
      await this.scheduleNextAlarm(now);

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
    adminMode: 'webauthn' | 'password' | 'softkey';
    attestation?: AttestationJSON;
    softkeyPubJwk?: ECDSAPublicKeyJWK;
    lockKeyB64u: Base64Url;
  }): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadActiveRecord();
      assertUuidMatch(record.uuid, params.uuid);
      if (record.lockKey !== '') {
        throw new StateTransitionError('INVALID_TRANSITION', 'channel already finalized');
      }

      // H-1: Enforce securityProfile → adminMode binding (prevent downgrade attack)
      const requiresWebAuthn =
        record.securityProfile === 'secure' ||
        record.securityProfile === 'strict' ||
        record.securityProfile === 'hardware_only';
      if (requiresWebAuthn && params.adminMode !== 'webauthn') {
        throw new StateTransitionError(
          'LOCK_FORBIDDEN',
          `security profile '${record.securityProfile}' requires webauthn admin mode`
        );
      }

      let adminCredential: StoredCredential | SoftkeyCredential;

      if (params.adminMode === 'password' || params.adminMode === 'softkey') {
        if (!params.softkeyPubJwk) {
          throw new StateTransitionError(
            'LOCK_FORBIDDEN',
            'softkeyPubJwk required for password mode'
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

        // Require UV for secure and all legacy strict/hardware_only profiles
        const requireUV =
          record.securityProfile === 'secure' ||
          record.securityProfile === 'strict' ||
          record.securityProfile === 'hardware_only';

        let verification: AttestationVerificationResult;
        try {
          verification = await verifyAttestation({
            attestationObjectB64u: params.attestation.response.attestationObject,
            clientDataJSONB64u: params.attestation.response.clientDataJSON,
            expectedRpId: this.env.RP_ID,
            expectedOrigin: this.env.RP_ORIGIN,
            expectedChallenge: decodeBase64Url(storedChallenge),
            requireUserVerification: requireUV,
          });
        } catch (err) {
          throw new StateTransitionError(
            'ATTESTATION_UNVERIFIABLE',
            err instanceof Error ? err.message : 'Attestation verification failed'
          );
        }

        // M-4: Reject unverifiable attestation for secure profiles
        if (requiresWebAuthn && !verification.verified) {
          throw new StateTransitionError(
            'ATTESTATION_UNVERIFIABLE',
            `security profile '${record.securityProfile}' requires verified attestation (got fmt:'${verification.fmt}')`
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
      await this.scheduleNextAlarm();
    });
  }

  async beginCompoundChallenge(
    uuid: string,
    now: number = Date.now(),
    context: BeginRequestContext = { callerKey: undefined }
  ): Promise<{
    challenge: CompoundChallenge;
    allowCredentials?: Array<{
      id: Base64Url;
      type: 'public-key';
    }>;
    receiverPubFpr?: HexString;
    receiverPubJwk?: RSAPublicKeyJWK;
    currentVersion: number;
    securityProfile: ChannelRecord['securityProfile'];
    adminMode: ChannelRecord['adminMode'];
  }> {
    const { response } = await this.beginCompoundChallengeInternal(uuid, now, context);
    return response;
  }

  private async beginCompoundChallengeInternal(
    uuid: string,
    now: number = Date.now(),
    context: BeginRequestContext = { callerKey: undefined }
  ): Promise<{
    response: {
      challenge: CompoundChallenge;
      allowCredentials?: Array<{
        id: Base64Url;
        type: 'public-key';
      }>;
      receiverPubFpr?: HexString;
      receiverPubJwk?: RSAPublicKeyJWK;
      currentVersion: number;
      securityProfile: ChannelRecord['securityProfile'];
      adminMode: ChannelRecord['adminMode'];
    };
    commitCookieSignal?: CommitCookieSignal;
  }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadActiveRecord(now);
      assertUuidMatch(record.uuid, uuid);

      const existingChallenge =
        await this.ctx.storage.get<StoredCompoundChallenge>(COMPOUND_CHALLENGE_KEY);
      const activeChallenge =
        existingChallenge &&
        existingChallenge.consumedAt === undefined &&
        existingChallenge.expiresAt > now
          ? existingChallenge
          : null;
      let challenge = activeChallenge;

      if (!challenge) {
        this.enforceRateLimit('compound_begin', now);

        const cryptoApi = getCryptoApi();
        const id = encodeBase64Url(
          cryptoApi.getRandomValues(new Uint8Array(COMPOUND_CHALLENGE_ID_BYTES))
        );
        const seed = encodeBase64Url(cryptoApi.getRandomValues(new Uint8Array(CHALLENGE_BYTES)));
        const issuedAt = asUnixMs(now);
        const expiresAt = asUnixMs(now + CHALLENGE_TTL_MS);
        challenge = context.callerKey
          ? {
              id,
              seed,
              issuedAt,
              expiresAt,
              commitTokenMode: COMMIT_TOKEN_MODE,
            }
          : { id, seed, expiresAt };

        await this.ctx.storage.put(COMPOUND_CHALLENGE_KEY, challenge);
      }

      const response: {
        challenge: CompoundChallenge;
        allowCredentials?: Array<{
          id: Base64Url;
          type: 'public-key';
        }>;
        currentVersion: number;
        receiverPubFpr?: HexString;
        receiverPubJwk?: RSAPublicKeyJWK;
        securityProfile: ChannelRecord['securityProfile'];
        adminMode: ChannelRecord['adminMode'];
      } = {
        challenge: {
          id: challenge.id,
          seed: challenge.seed,
          expiresAt: challenge.expiresAt,
        },
        currentVersion: record.version,
        securityProfile: record.securityProfile,
        adminMode: record.adminMode,
      };
      if (record.adminMode === 'webauthn') {
        const storedCredential = record.adminCredential as StoredCredential;
        if (storedCredential.credentialId) {
          response.allowCredentials = [
            {
              id: storedCredential.credentialId,
              type: 'public-key',
            },
          ];
        }
      }
      if (record.receiver) {
        response.receiverPubFpr = record.receiver.pubFpr;
        response.receiverPubJwk = record.receiver.pubJwk;
      }

      const commitCookieSignal = await this.buildCommitCookieSignal(
        'compound',
        record.uuid,
        challenge,
        context.callerKey
      );

      return {
        response,
        ...(commitCookieSignal ? { commitCookieSignal } : {}),
      };
    });
  }

  async commitCompound(
    params: CompoundCommitParams,
    now: number = Date.now(),
    context: CommitRequestContext = { callerKey: undefined, commitToken: undefined }
  ): Promise<void> {
    await this.commitCompoundInternal(params, now, context);
  }

  private async commitCompoundInternal(
    params: CompoundCommitParams,
    now: number = Date.now(),
    context: CommitRequestContext = { callerKey: undefined, commitToken: undefined }
  ): Promise<{ commitCookieSignal?: CommitCookieSignal }> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadActiveRecord(now);
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

      // M-2: Cross-validate intent.receiverPubFpr against stored receiver fingerprint
      if (intent.op === 'update' && record.receiver) {
        if (intent.receiverPubFpr !== record.receiver.pubFpr) {
          throw new StateTransitionError(
            'LOCK_FORBIDDEN',
            'intent receiverPubFpr does not match locked receiver fingerprint'
          );
        }
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
        throw this.withCommitCookieSignalError(
          'compound',
          'CHALLENGE_INVALID',
          'compound challenge not found',
          context.commitToken ? { action: 'clear', kind: 'compound' } : undefined
        );
      }
      if (challenge.consumedAt !== undefined) {
        throw this.withCommitCookieSignalError(
          'compound',
          'CHALLENGE_CONSUMED',
          'compound challenge already consumed',
          this.shouldClearCommitCookie(challenge, context.commitToken)
            ? { action: 'clear', kind: 'compound' }
            : undefined
        );
      }
      if (challenge.expiresAt <= now) {
        await this.ctx.storage.delete(COMPOUND_CHALLENGE_KEY);
        throw this.withCommitCookieSignalError(
          'compound',
          'CHALLENGE_INVALID',
          'compound challenge expired',
          this.shouldClearCommitCookie(challenge, context.commitToken)
            ? { action: 'clear', kind: 'compound' }
            : undefined
        );
      }

      const tokenHash = await this.validateCommitToken({
        kind: 'compound',
        uuid: record.uuid,
        challenge,
        now,
        callerKey: context.callerKey,
        commitToken: context.commitToken,
      });

      if (intent.op === 'update') {
        if (!record.receiver) {
          throw new StateTransitionError(
            'INVALID_TRANSITION',
            'delivery requires a locked receiver identity'
          );
        }

        await this.validateCipherBundle(intent, record.receiver.pubFpr);
      }

      this.enforceRateLimit('compound_commit', now, tokenHash);

      const expectedChallengeBytes = await sha256Bytes([
        toUtf8Bytes(DOMAIN.CHALLENGE),
        toUtf8Bytes(record.uuid),
        decodeBase64Url(challenge.id),
        toUtf8Bytes(params.intentHash),
        decodeBase64Url(challenge.seed),
      ]);

      let verifiedWebAuthnSignCount: number | null = null;

      const isPasswordMode = record.adminMode === 'password' || record.adminMode === 'softkey';

      if (isPasswordMode) {
        if (
          !('adminMode' in params) ||
          (params.adminMode !== 'password' && params.adminMode !== 'softkey') ||
          !('softkeySignature' in params)
        ) {
          throw new StateTransitionError(
            'ASSERTION_INVALID',
            'password commit payload required for password/softkey channel'
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
        if (
          'adminMode' in params &&
          (params.adminMode === 'softkey' || params.adminMode === 'password')
        ) {
          throw new StateTransitionError(
            'ASSERTION_INVALID',
            'webauthn commit payload required for webauthn channel'
          );
        }

        const verifyResult = await verifyAssertion({
          // biome-ignore lint/suspicious/noExplicitAny: narrowing union after password/softkey guard
          assertion: (params as any).assertion,
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

      if (intent.op === 'delete') {
        new SecretVaultStateMachine(record).commitDelete();
        await this.finalizeTerminalState(record.uuid, 'deleted', asUnixMs(now));
        // Broadcast channel_closed to all connected clients
        broadcastToWebSockets(this.ctx, { type: 'channel_closed', reason: 'deleted' });
        this.closeAllWebSockets('deleted');
        return;
      }

      const nextRecord = new SecretVaultStateMachine(record).commitDelivery({
        cipherBundle: intent.cipherBundle,
        deliveredAt: intent.timestamp,
      });
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
      await this.scheduleNextAlarm(now);

      // Broadcast DELIVERED state to connected clients (e.g., receiver's SharePage)
      broadcastToWebSockets(this.ctx, buildStateChangedMessage(updatedRecord));
    });

    return context.commitToken !== undefined
      ? { commitCookieSignal: { action: 'clear', kind: 'compound' } as const }
      : {};
  }

  async beginLockChallenge(
    uuid: string,
    now: number = Date.now(),
    context: BeginRequestContext = { callerKey: undefined }
  ): Promise<import('@zerolink/shared').LockChallenge> {
    const { lockChallenge } = await this.beginLockChallengeInternal(uuid, now, context);
    return lockChallenge;
  }

  private async beginLockChallengeInternal(
    uuid: string,
    now: number = Date.now(),
    context: BeginRequestContext = { callerKey: undefined }
  ): Promise<{
    lockChallenge: import('@zerolink/shared').LockChallenge;
    commitCookieSignal?: CommitCookieSignal;
  }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadActiveRecord(now);
      assertWaitingState(record);
      assertUuidMatch(record.uuid, uuid);

      const existingChallenge = await this.loadLockChallenge();
      const activeChallenge =
        existingChallenge &&
        existingChallenge.consumedAt === undefined &&
        existingChallenge.expiresAt > now
          ? existingChallenge
          : null;

      if (activeChallenge) {
        const commitCookieSignal = await this.buildCommitCookieSignal(
          'lock',
          record.uuid,
          activeChallenge,
          context.callerKey
        );

        return {
          lockChallenge: {
            id: activeChallenge.id,
            challenge: activeChallenge.challenge,
            expiresAt: activeChallenge.expiresAt,
          },
          ...(commitCookieSignal ? { commitCookieSignal } : {}),
        };
      }

      this.enforceRateLimit('lock_begin', now);

      const cryptoApi = getCryptoApi();
      const id = encodeBase64Url(
        cryptoApi.getRandomValues(new Uint8Array(LOCK_CHALLENGE_ID_BYTES))
      );
      const challenge = encodeBase64Url(cryptoApi.getRandomValues(new Uint8Array(CHALLENGE_BYTES)));
      const issuedAt = asUnixMs(now);
      const expiresAt = asUnixMs(now + CHALLENGE_TTL_MS);
      const stored: StoredLockChallenge = context.callerKey
        ? {
            id,
            challenge,
            issuedAt,
            expiresAt,
            commitTokenMode: COMMIT_TOKEN_MODE,
          }
        : { id, challenge, expiresAt };

      await this.saveLockChallenge(stored);
      const commitCookieSignal = await this.buildCommitCookieSignal(
        'lock',
        record.uuid,
        stored,
        context.callerKey
      );

      return {
        lockChallenge: {
          id: stored.id,
          challenge: stored.challenge,
          expiresAt: stored.expiresAt,
        },
        ...(commitCookieSignal ? { commitCookieSignal } : {}),
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
    now: number = Date.now(),
    context: CommitRequestContext = { callerKey: undefined, commitToken: undefined }
  ): Promise<void> {
    await this.commitLockChallengeInternal(
      {
        uuid,
        lockChallengeId,
        lockProof,
        receiverPubJwk,
        receiverPubFpr,
        lockedAt,
      },
      now,
      context
    );
  }

  private async commitLockChallengeInternal(
    {
      uuid,
      lockChallengeId,
      lockProof,
      receiverPubJwk,
      receiverPubFpr,
      lockedAt,
    }: CommitLockChallengeParams,
    now: number = Date.now(),
    context: CommitRequestContext = { callerKey: undefined, commitToken: undefined }
  ): Promise<{ commitCookieSignal?: CommitCookieSignal }> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.loadActiveRecord(now);
      assertWaitingState(record);
      assertUuidMatch(record.uuid, uuid);

      const resolvedChallenge = await this.resolveLockChallenge(lockChallengeId);
      if (!resolvedChallenge) {
        throw this.withCommitCookieSignalError(
          'lock',
          'CHALLENGE_INVALID',
          'lock challenge not found',
          context.commitToken ? { action: 'clear', kind: 'lock' } : undefined
        );
      }

      const { challenge, location } = resolvedChallenge;
      if (challenge.expiresAt <= now) {
        await this.deleteResolvedLockChallenge(resolvedChallenge);
        throw this.withCommitCookieSignalError(
          'lock',
          'CHALLENGE_INVALID',
          'lock challenge expired',
          this.shouldClearCommitCookie(challenge, context.commitToken)
            ? { action: 'clear', kind: 'lock' }
            : undefined
        );
      }
      if (challenge.consumedAt !== undefined) {
        throw this.withCommitCookieSignalError(
          'lock',
          'CHALLENGE_CONSUMED',
          'lock challenge already consumed',
          this.shouldClearCommitCookie(challenge, context.commitToken)
            ? { action: 'clear', kind: 'lock' }
            : undefined
        );
      }

      const tokenHash = await this.validateCommitToken({
        kind: 'lock',
        uuid: record.uuid,
        challenge,
        now,
        callerKey: context.callerKey,
        commitToken: context.commitToken,
      });

      this.enforceRateLimit('lock_commit', now, tokenHash);

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

      // M-1: Validate receiverPubFpr matches SHA256(SPKI(receiverPubJwk))
      const cryptoApiLock = getCryptoApi();
      let importedReceiverKey: CryptoKey;
      try {
        importedReceiverKey = await cryptoApiLock.subtle.importKey(
          'jwk',
          receiverPubJwk as unknown as JsonWebKey,
          { name: 'RSA-OAEP', hash: 'SHA-256' },
          true,
          ['encrypt']
        );
      } catch {
        throw new StateTransitionError('LOCK_FORBIDDEN', 'invalid receiver public key JWK');
      }
      const spkiBytes = new Uint8Array(
        await cryptoApiLock.subtle.exportKey('spki', importedReceiverKey)
      );
      const computedFpr = await sha256Hex([spkiBytes]);
      if (computedFpr !== receiverPubFpr) {
        throw new StateTransitionError(
          'LOCK_FORBIDDEN',
          'receiverPubFpr does not match SHA256(SPKI(receiverPubJwk))'
        );
      }

      await this.saveResolvedLockChallenge({
        location,
        challenge: {
          ...challenge,
          consumedAt: asUnixMs(now),
        },
      });
      const nextRecord = new SecretVaultStateMachine(record).commitLock({
        receiverPubJwk,
        receiverPubFpr,
        lockedAt,
      });
      await this.saveRecord(nextRecord);
      await this.scheduleNextAlarm(now);

      // Broadcast LOCKED state to connected clients (e.g., sender's ManagePage)
      broadcastToWebSockets(this.ctx, buildStateChangedMessage(nextRecord));
    });

    return context.commitToken !== undefined
      ? { commitCookieSignal: { action: 'clear', kind: 'lock' } as const }
      : {};
  }

  private async applyTransition(
    transition: (machine: SecretVaultStateMachine) => ChannelRecord
  ): Promise<ChannelRecord> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.loadActiveRecord();
      const next = transition(new SecretVaultStateMachine(current));
      await this.saveRecord(next);
      await this.scheduleNextAlarm();
      return next;
    });
  }

  private async scheduleNextAlarm(now: number = Date.now()): Promise<void> {
    const purgeResult = await this.purgeExpiredRecord(now);
    if (purgeResult.purged) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const nonceAlarmState = await reconcileNonceAlarmState(this.ctx.storage, now);
    this.logNonceAlarmState(nonceAlarmState);

    const { record } = purgeResult;
    const recordAlarmAt = record ? this.getRecordAlarmAt(record, now) : null;
    const nonceAlarmAt = nonceAlarmState.nextAlarmAt;
    const nextAlarmAt = this.getEarlierAlarm(recordAlarmAt, nonceAlarmAt);
    if (!this.isValidFutureAlarmAt(nextAlarmAt, now)) {
      if (nextAlarmAt !== null) {
        this.logRejectedAlarmCandidate(nextAlarmAt, now, recordAlarmAt, nonceAlarmAt);
      }
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(nextAlarmAt);
  }

  private async loadRecord(): Promise<ChannelRecord> {
    const record = await this.ctx.storage.get<ChannelRecord>(CHANNEL_RECORD_KEY);
    if (!record) {
      throw new StateTransitionError('RECORD_NOT_FOUND', 'channel record not initialized');
    }
    return record;
  }

  /**
   * Load the channel record without throwing. Returns undefined if not found
   * or if the record has already reached a terminal state and must be purged.
   */
  private async tryLoadActiveRecord(now: number = Date.now()): Promise<ChannelRecord | undefined> {
    const record = await this.ctx.storage.get<ChannelRecord>(CHANNEL_RECORD_KEY);
    if (!record) {
      return undefined;
    }

    if (!this.shouldPurgeRecord(record, now)) {
      return record;
    }

    await this.finalizeTerminalRecord(record, now);
    return undefined;
  }

  private async loadActiveRecord(now: number = Date.now()): Promise<ChannelRecord> {
    const record = await this.loadRecord();
    if (!this.shouldPurgeRecord(record, now)) {
      return record;
    }

    await this.finalizeTerminalRecord(record, now);
    throw new StateTransitionError('RECORD_NOT_FOUND', 'channel record not initialized');
  }

  private async saveRecord(record: ChannelRecord): Promise<void> {
    await this.ctx.storage.put(CHANNEL_RECORD_KEY, record);
  }

  private async purgeExpiredRecord(
    now: number
  ): Promise<{ purged: true } | { purged: false; record: ChannelRecord | undefined }> {
    const record = await this.ctx.storage.get<ChannelRecord>(CHANNEL_RECORD_KEY);
    if (!record || !this.shouldPurgeRecord(record, now)) {
      return { purged: false, record };
    }

    await this.finalizeTerminalRecord(record, now);

    // Broadcast channel_closed to any connected clients
    broadcastToWebSockets(this.ctx, { type: 'channel_closed', reason: 'expired' });
    this.closeAllWebSockets('expired');
    return { purged: true };
  }

  private async purgeChannelStorage(): Promise<void> {
    const keys = await this.listPurgeKeys();
    if (keys.length > 0) {
      await this.ctx.storage.delete(keys);
    }
    await this.ctx.storage.deleteAlarm();
  }

  private async finalizeTerminalRecord(record: ChannelRecord, now: number): Promise<void> {
    if (this.hasInvalidRecordExpiry(record)) {
      this.logInvalidRecordExpiry(record);
    }
    const expiresAt = this.recordExpiresAt(record);
    const reason =
      record.state === CHANNEL_STATE.DELETED
        ? 'deleted'
        : record.state === CHANNEL_STATE.EXPIRED || expiresAt === null || expiresAt <= now
          ? 'expired'
          : 'deleted';
    await this.finalizeTerminalState(record.uuid, reason, asUnixMs(now));
  }

  private async finalizeTerminalState(
    uuid: string,
    reason: StoredTerminalTombstone['reason'],
    finalizedAt: UnixMs = asUnixMs(Date.now())
  ): Promise<void> {
    await this.purgeChannelStorage();
    await this.ctx.storage.put(TERMINAL_TOMBSTONE_KEY, {
      uuid,
      reason,
      finalizedAt,
    } satisfies StoredTerminalTombstone);
  }

  private async listPurgeKeys(): Promise<string[]> {
    const [legacyLockChallengeKeys, nonceKeys, nonceIndexKeys] = await Promise.all([
      this.listKeysWithPrefix(LEGACY_LOCK_CHALLENGE_KEY_PREFIX),
      this.listKeysWithPrefix(NONCE_KEY_PREFIX),
      this.listKeysWithPrefix(NONCE_INDEX_KEY_PREFIX),
    ]);

    return [
      CHANNEL_RECORD_KEY,
      CREATION_CHALLENGE_KEY,
      LOCK_CHALLENGE_KEY,
      COMPOUND_CHALLENGE_KEY,
      ...legacyLockChallengeKeys,
      ...nonceKeys,
      ...nonceIndexKeys,
    ];
  }

  private async listKeysWithPrefix(prefix: string): Promise<string[]> {
    const entries = await this.ctx.storage.list({ prefix });
    return [...entries.keys()];
  }

  private shouldPurgeRecord(record: ChannelRecord, now: number): boolean {
    const expiresAt = this.recordExpiresAt(record);
    return (
      record.state === CHANNEL_STATE.DELETED ||
      record.state === CHANNEL_STATE.EXPIRED ||
      expiresAt === null ||
      expiresAt <= now
    );
  }

  private recordExpiresAt(record: ChannelRecord): number | null {
    const expiresAt = Number(record.expiresAt);
    return Number.isFinite(expiresAt) ? expiresAt : null;
  }

  private hasInvalidRecordExpiry(record: ChannelRecord): boolean {
    return this.recordExpiresAt(record) === null;
  }

  private getRecordAlarmAt(record: ChannelRecord, now: number): number | null {
    const expiresAt = this.recordExpiresAt(record);
    if (expiresAt === null || expiresAt <= now) {
      return null;
    }
    return expiresAt;
  }

  private isValidFutureAlarmAt(candidate: number | null, now: number): candidate is number {
    return candidate !== null && Number.isFinite(candidate) && candidate > now;
  }

  private logInvalidRecordExpiry(record: ChannelRecord): void {
    // biome-ignore lint/suspicious/noConsole: intentional production diagnostics for alarm loops
    console.warn('[SecretVault] invalid_record_expiry', {
      expiresAtType: typeof record.expiresAt,
      state: record.state,
    });
  }

  private logNonceAlarmState(state: NonceAlarmState): void {
    if (state.deletedExpiredEntries === 0 && state.deletedInvalidEntries === 0) {
      return;
    }

    // biome-ignore lint/suspicious/noConsole: intentional production diagnostics for alarm loops
    console.warn('[SecretVault] reconciled_nonce_alarm_state', {
      deletedExpiredEntries: state.deletedExpiredEntries,
      deletedInvalidEntries: state.deletedInvalidEntries,
      nextAlarmAt: state.nextAlarmAt,
    });
  }

  private logRejectedAlarmCandidate(
    nextAlarmAt: number,
    now: number,
    recordAlarmAt: number | null,
    nonceAlarmAt: number | null
  ): void {
    // biome-ignore lint/suspicious/noConsole: intentional production diagnostics for alarm loops
    console.warn('[SecretVault] rejected_alarm_candidate', {
      nextAlarmAt,
      nonceAlarmAt,
      now,
      recordAlarmAt,
    });
  }

  /**
   * Close all connected WebSockets after a terminal event (delete/expire).
   */
  private closeAllWebSockets(reason: string): void {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.close(WS_CLOSE_CHANNEL_GONE, reason);
      } catch {
        // Already closed
      }
    }
  }

  private getEarlierAlarm(left: number | null, right: number | null): number | null {
    if (left === null) return right;
    if (right === null) return left;
    return Math.min(left, right);
  }

  private async loadLockChallenge(): Promise<StoredLockChallenge | undefined> {
    return this.ctx.storage.get<StoredLockChallenge>(LOCK_CHALLENGE_KEY);
  }

  private async saveLockChallenge(challenge: StoredLockChallenge): Promise<void> {
    await this.ctx.storage.put(LOCK_CHALLENGE_KEY, challenge);
  }

  private async deleteLockChallenge(): Promise<void> {
    await this.ctx.storage.delete(LOCK_CHALLENGE_KEY);
  }

  private getLegacyLockChallengeStorageKey(id: Base64Url): string {
    return `${LEGACY_LOCK_CHALLENGE_KEY_PREFIX}${id}`;
  }

  private async resolveLockChallenge(id: Base64Url): Promise<ResolvedLockChallenge | undefined> {
    const fixedChallenge = await this.loadLockChallenge();
    if (fixedChallenge && fixedChallenge.id === id) {
      return {
        challenge: fixedChallenge,
        location: 'fixed',
      };
    }

    const legacyChallenge = await this.ctx.storage.get<StoredLockChallenge>(
      this.getLegacyLockChallengeStorageKey(id)
    );
    if (!legacyChallenge) {
      return undefined;
    }

    return {
      challenge: legacyChallenge,
      location: 'legacy',
    };
  }

  private async saveResolvedLockChallenge({
    challenge,
    location,
  }: ResolvedLockChallenge): Promise<void> {
    if (location === 'fixed') {
      await this.saveLockChallenge(challenge);
      return;
    }

    await this.ctx.storage.put(this.getLegacyLockChallengeStorageKey(challenge.id), challenge);
  }

  private async deleteResolvedLockChallenge({
    challenge,
    location,
  }: ResolvedLockChallenge): Promise<void> {
    if (location === 'fixed') {
      await this.deleteLockChallenge();
      return;
    }

    await this.ctx.storage.delete(this.getLegacyLockChallengeStorageKey(challenge.id));
  }

  private getCallerKeyFromRequest(request: Request): Base64Url | undefined {
    const callerKey = request.headers.get(INTERNAL_CALLER_KEY_HEADER)?.trim();
    return callerKey ? (callerKey as Base64Url) : undefined;
  }

  private getCommitTokenFromRequest(request: Request): string | undefined {
    const commitToken = request.headers.get(INTERNAL_COMMIT_TOKEN_HEADER)?.trim();
    return commitToken || undefined;
  }

  private withCommitCookieSignal(response: Response, signal?: CommitCookieSignal): Response {
    if (!signal) {
      return response;
    }

    const headers = new Headers(response.headers);
    appendInternalCommitCookieSignal(headers, signal);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private withCommitCookieSignalFromError(error: unknown, response: Response): Response {
    if (!(error instanceof CommitCookieStateTransitionError)) {
      return response;
    }

    return this.withCommitCookieSignal(response, error.commitCookieSignal);
  }

  private withCommitCookieSignalError(
    _kind: CommitCookieKind,
    code: StateTransitionError['code'],
    message: string,
    signal?: CommitCookieSignal
  ): StateTransitionError {
    if (!signal) {
      return new StateTransitionError(code, message);
    }

    return new CommitCookieStateTransitionError(code, message, signal);
  }

  private shouldClearCommitCookie(
    challenge: Pick<StoredLockChallenge | StoredCompoundChallenge, 'commitTokenMode'>,
    commitToken?: string
  ): boolean {
    return challenge.commitTokenMode === COMMIT_TOKEN_MODE && commitToken !== undefined;
  }

  private async buildCommitCookieSignal(
    kind: CommitCookieKind,
    uuid: string,
    challenge: Pick<
      StoredLockChallenge | StoredCompoundChallenge,
      'id' | 'issuedAt' | 'expiresAt' | 'commitTokenMode'
    >,
    callerKey?: Base64Url
  ): Promise<CommitCookieSignal | undefined> {
    if (
      challenge.commitTokenMode !== COMMIT_TOKEN_MODE ||
      challenge.issuedAt === undefined ||
      !callerKey
    ) {
      return undefined;
    }

    const token = await createCommitToken(this.env.COMMIT_TOKEN_SECRET, {
      kind,
      uuid,
      challengeId: challenge.id,
      callerKey,
      iat: challenge.issuedAt,
      exp: challenge.expiresAt,
    });
    return {
      action: 'set',
      kind,
      token,
      exp: challenge.expiresAt,
    };
  }

  private async validateCommitToken({
    kind,
    uuid,
    challenge,
    now,
    callerKey,
    commitToken,
  }: {
    kind: CommitCookieKind;
    uuid: string;
    challenge: Pick<
      StoredLockChallenge | StoredCompoundChallenge,
      'id' | 'issuedAt' | 'expiresAt' | 'commitTokenMode'
    >;
    now: number;
    callerKey: Base64Url | undefined;
    commitToken: string | undefined;
  }): Promise<string> {
    if (challenge.commitTokenMode !== COMMIT_TOKEN_MODE) {
      return 'shared';
    }

    if (!callerKey) {
      throw new StateTransitionError('CHALLENGE_INVALID', 'caller key missing');
    }

    if (!commitToken) {
      throw new StateTransitionError('CHALLENGE_INVALID', 'commit token missing');
    }

    const payload = await verifyCommitToken(this.env.COMMIT_TOKEN_SECRET, commitToken);
    if (!payload) {
      throw new CommitCookieStateTransitionError('CHALLENGE_INVALID', 'commit token invalid', {
        action: 'clear',
        kind,
      });
    }

    if (
      challenge.issuedAt === undefined ||
      payload.kind !== kind ||
      payload.uuid !== uuid ||
      payload.challengeId !== challenge.id ||
      payload.callerKey !== callerKey ||
      payload.iat !== challenge.issuedAt ||
      payload.iat > payload.exp ||
      payload.exp > challenge.expiresAt ||
      payload.exp <= now
    ) {
      throw new CommitCookieStateTransitionError(
        'CHALLENGE_INVALID',
        'commit token does not match active challenge',
        {
          action: 'clear',
          kind,
        }
      );
    }

    return hashCommitToken(commitToken);
  }

  private async validateCipherBundle(intent: UpdateIntent, lockedReceiverPubFpr: HexString) {
    let ciphertextBytes: Uint8Array;
    try {
      ciphertextBytes = decodeBase64Url(intent.cipherBundle.ciphertext);
    } catch {
      throw new StateTransitionError(
        'CIPHER_BUNDLE_INVALID',
        'cipherBundle.ciphertext is not valid base64url'
      );
    }

    const computedHash = await sha256Hex([ciphertextBytes]);
    if (!constantTimeEqual(computedHash, intent.cipherBundle.ciphertextHash)) {
      throw new StateTransitionError(
        'CIPHER_BUNDLE_INVALID',
        'cipherBundle.ciphertextHash does not match ciphertext'
      );
    }

    const expectedAad = encodeBase64Url(
      buildCipherBundleAadBytes({
        uuid: intent.uuid,
        version: intent.version,
        receiverPubFpr: lockedReceiverPubFpr,
      })
    );
    if (!constantTimeEqual(intent.cipherBundle.aad, expectedAad)) {
      throw new StateTransitionError(
        'CIPHER_BUNDLE_INVALID',
        'cipherBundle.aad does not match the expected binding'
      );
    }
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
      return mapError(error, { appEnv: this.env.APP_ENV, handler: 'create_begin' });
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
      const isPasswordMode =
        parsed.data.adminMode === 'password' || parsed.data.adminMode === 'softkey';
      // biome-ignore lint/suspicious/noExplicitAny: complex union schema mismatch
      const commitParams: any = {
        uuid: parsed.data.uuid,
        adminMode: parsed.data.adminMode,
        attestation: parsed.data.adminMode === 'webauthn' ? parsed.data.attestation : undefined,
        softkeyPubJwk: isPasswordMode
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
      return mapError(error, { appEnv: this.env.APP_ENV, handler: 'create_finish' });
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
      const result = await this.beginLockChallengeInternal(parsed.data.uuid, Date.now(), {
        callerKey: this.getCallerKeyFromRequest(request),
      });
      return this.withCommitCookieSignal(
        jsonResponse({ ok: true, lockChallenge: result.lockChallenge }, 200),
        result.commitCookieSignal
      );
    } catch (error) {
      return this.withCommitCookieSignalFromError(
        error,
        mapError(error, { appEnv: this.env.APP_ENV, handler: 'lock_begin' })
      );
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
      const result = await this.beginCompoundChallengeInternal(parsed.data.uuid, Date.now(), {
        callerKey: this.getCallerKeyFromRequest(request),
      });
      return this.withCommitCookieSignal(
        jsonResponse({ ok: true, ...result.response }, 200),
        result.commitCookieSignal
      );
    } catch (error) {
      return this.withCommitCookieSignalFromError(
        error,
        mapError(error, { appEnv: this.env.APP_ENV, handler: 'compound_begin' })
      );
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
      let result: { commitCookieSignal?: CommitCookieSignal } | undefined;
      if (parsedSoftkey.success) {
        result = await this.commitCompoundInternal(
          {
            adminMode: parsedSoftkey.data.adminMode,
            uuid: parsedSoftkey.data.uuid,
            softkeySignature: parsedSoftkey.data.softkeySignature,
            intentHash: parsedSoftkey.data.intentHash,
            intent: parsedSoftkey.data.intent,
          },
          Date.now(),
          {
            callerKey: this.getCallerKeyFromRequest(request),
            commitToken: this.getCommitTokenFromRequest(request),
          }
        );
      } else if (parsedWebAuthn.success) {
        result = await this.commitCompoundInternal(
          {
            uuid: parsedWebAuthn.data.uuid,
            assertion: normalizeAssertion(parsedWebAuthn.data.assertion),
            intentHash: parsedWebAuthn.data.intentHash,
            intent: parsedWebAuthn.data.intent,
          },
          Date.now(),
          {
            callerKey: this.getCallerKeyFromRequest(request),
            commitToken: this.getCommitTokenFromRequest(request),
          }
        );
      }

      return this.withCommitCookieSignal(
        jsonResponse({ ok: true }, 200),
        result?.commitCookieSignal
      );
    } catch (error) {
      return this.withCommitCookieSignalFromError(
        error,
        mapError(error, { appEnv: this.env.APP_ENV, handler: 'compound_commit' })
      );
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
      const result = await this.commitLockChallengeInternal(
        parsed.data as unknown as CommitLockChallengeParams,
        Date.now(),
        {
          callerKey: this.getCallerKeyFromRequest(request),
          commitToken: this.getCommitTokenFromRequest(request),
        }
      );
      return this.withCommitCookieSignal(
        jsonResponse({ ok: true }, 200),
        result.commitCookieSignal
      );
    } catch (error) {
      return this.withCommitCookieSignalFromError(
        error,
        mapError(error, { appEnv: this.env.APP_ENV, handler: 'lock_commit' })
      );
    }
  }

  private async handleGetPublicState(): Promise<Response> {
    try {
      const record = await this.loadActiveRecord();
      const body: Record<string, unknown> = {
        ok: true,
        state: record.state,
        adminMode: record.adminMode,
        securityProfile: record.securityProfile,
      };
      if (record.receiver?.pubFpr) {
        // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
        body['receiverPubFpr'] = record.receiver.pubFpr;
      }
      return jsonResponse(body, 200);
    } catch (error) {
      return mapError(error, { appEnv: this.env.APP_ENV, handler: 'get_public_state' });
    }
  }

  private async handleGetDecryptPayload(): Promise<Response> {
    try {
      const record = await this.loadActiveRecord();
      if (
        record.state !== CHANNEL_STATE.DELIVERED ||
        !record.cipherBundle ||
        !record.receiver ||
        record.deliveredAt == null ||
        record.version < 1
      ) {
        return jsonError('CHANNEL_NOT_DELIVERED', 409);
      }
      return jsonResponse(
        {
          ok: true,
          cipherBundle: record.cipherBundle,
          receiverPubFpr: record.receiver.pubFpr,
          cipherVersion: record.version - 1,
          deliveredAt: record.deliveredAt,
        },
        200
      );
    } catch (error) {
      return mapError(error, { appEnv: this.env.APP_ENV, handler: 'get_decrypt_payload' });
    }
  }
}
