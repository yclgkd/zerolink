import type {
  Base64Url,
  ChannelRecord,
  CipherBundle,
  HexString,
  LockChallenge,
  LockCommitRequest,
  RSAPublicKeyJWK,
  UnixMs,
} from '@zerolink/shared';
import {
  CHALLENGE_BYTES,
  CHALLENGE_TTL_MS,
  CHANNEL_STATE,
  DOMAIN,
  LockBeginRequestSchema,
  LockCommitRequestSchema,
} from '@zerolink/shared';

export interface SecretVaultEnv {
  SECRET_VAULT: DurableObjectNamespace;
  SECRETS_KV: KVNamespace;
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

interface StoredLockChallenge {
  id: Base64Url;
  challenge: Base64Url;
  expiresAt: UnixMs;
  consumedAt?: UnixMs;
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
  | 'LOCK_FORBIDDEN';

export class StateTransitionError extends Error {
  readonly code: StateTransitionErrorCode;

  constructor(code: StateTransitionErrorCode, message: string) {
    super(message);
    this.name = 'StateTransitionError';
    this.code = code;
  }
}

export const CHANNEL_RECORD_KEY = 'channel_record' as const;
export const LOCK_CHALLENGE_KEY_PREFIX = 'lock_challenge:' as const;

const LOCK_CHALLENGE_ID_BYTES = 16;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const encoder = new TextEncoder();

function asUnixMs(value: number): UnixMs {
  return value as UnixMs;
}

function getCryptoApi(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('WebCrypto is not available');
  }
  return cryptoApi;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function bytesToHex(bytes: Uint8Array): HexString {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') as HexString;
}

function bytesToBinary(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return binary;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): Base64Url {
  return btoa(bytesToBinary(bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '') as Base64Url;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error('invalid base64url');
  }

  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

  return binaryToBytes(atob(padded));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

async function sha256Hex(chunks: readonly Uint8Array[]): Promise<HexString> {
  const cryptoApi = getCryptoApi();
  const merged = concatBytes(chunks);
  const digest = await cryptoApi.subtle.digest('SHA-256', toArrayBufferBytes(merged));
  return bytesToHex(new Uint8Array(digest));
}

function toUtf8Bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function lockChallengeStorageKey(id: Base64Url): string {
  return `${LOCK_CHALLENGE_KEY_PREFIX}${id}`;
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

  constructor(ctx: DurableObjectState, _env: SecretVaultEnv) {
    this.ctx = ctx;
    void _env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST') {
      return this.methodNotAllowed();
    }

    if (url.pathname === '/lock_begin') {
      return this.handleLockBegin(request);
    }

    if (url.pathname === '/lock_commit') {
      return this.handleLockCommit(request);
    }

    return this.notFound();
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

    return this.jsonError('INTERNAL_ERROR', 500);
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
