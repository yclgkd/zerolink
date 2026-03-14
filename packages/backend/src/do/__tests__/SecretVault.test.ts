import type {
  AssertionJSON,
  AttestationJSON,
  Base64Url,
  ChannelRecord,
  ChannelState,
  CipherBundle,
  DeleteIntent,
  HexString,
  LockChallenge,
  RSAPublicKeyJWK,
  StoredCredential,
  UnixMs,
  UpdateIntent,
  UUID,
} from '@zerolink/shared';
import {
  CHALLENGE_TTL_MS,
  CHANNEL_STATE,
  CHANNEL_TTL_MS,
  computeIntentHash,
  DOMAIN,
  NONCE_TTL_MS,
  SECURITY_PROFILE,
  TIMESTAMP_SKEW_MS,
} from '@zerolink/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createMockAssertion } from '../../__tests__/helpers/webauthn-fixtures.ts';
import { verifyAttestation } from '../../crypto/attestation.ts';
import * as softkeyCrypto from '../../crypto/softkey.ts';
import {
  CHANNEL_RECORD_KEY,
  COMPOUND_CHALLENGE_KEY,
  type CommitDeliveryParams,
  type CommitLockChallengeParams,
  type CommitLockParams,
  CREATION_CHALLENGE_KEY,
  LOCK_CHALLENGE_KEY,
  NONCE_INDEX_KEY_PREFIX,
  NONCE_KEY_PREFIX,
  RateLimitError,
  SecretVault,
  type SecretVaultEnv,
  SecretVaultStateMachine,
  StateTransitionError,
  type StoredCompoundChallenge,
  type StoredLockChallenge,
  type StoredTerminalTombstone,
  TERMINAL_TOMBSTONE_KEY,
} from '../SecretVault.ts';

vi.mock('../../crypto/softkey.ts', () => ({
  verifySoftkeySignature: vi.fn(),
}));

vi.mock('../../crypto/attestation.ts', () => ({
  verifyAttestation: vi.fn(),
}));

function asUuid(value: string): UUID {
  return value as UUID;
}

function asBase64Url(value: string): Base64Url {
  return value as Base64Url;
}

function asHex(value: string): HexString {
  return value as HexString;
}

function asUnixMs(value: number): UnixMs {
  return value as UnixMs;
}

const LEGACY_LOCK_CHALLENGE_KEY_PREFIX = 'lock_challenge:' as const;

function legacyLockChallengeStorageKey(id: Base64Url): string {
  return `${LEGACY_LOCK_CHALLENGE_KEY_PREFIX}${id}`;
}

function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
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
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return binaryToBytes(atob(padded));
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

async function sha256Hex(chunks: readonly Uint8Array[]): Promise<HexString> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBufferBytes(concatBytes(chunks)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  ) as HexString;
}

function createLockKey(): Base64Url {
  return encodeBase64Url(Uint8Array.from([1, 35, 69, 103, 137, 171, 205, 239]));
}

// Real RSA key pair generated in beforeAll for fingerprint validation tests
let realReceiverJwk: RSAPublicKeyJWK;
let realReceiverPubFpr: HexString;

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  realReceiverJwk = {
    kty: 'RSA',
    alg: 'RSA-OAEP-256',
    n: jwk.n as Base64Url,
    e: jwk.e as Base64Url,
    ext: true,
    key_ops: ['encrypt'] as const,
  };
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  realReceiverPubFpr = await sha256Hex([spki]);
});

function createReceiverJwk(): RSAPublicKeyJWK {
  return realReceiverJwk;
}

function createCipherBundle(): CipherBundle {
  return {
    ciphertext: asBase64Url('ciphertext'),
    iv: asBase64Url('iv1234567890'),
    aad: asBase64Url('aad-value'),
    encContentKey: asBase64Url('enc-content-key'),
    ciphertextHash: asHex('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
    padBlock: 4096,
  };
}

function createCommitLockParams(): CommitLockParams {
  return {
    receiverPubJwk: createReceiverJwk(),
    receiverPubFpr: realReceiverPubFpr,
    lockedAt: asUnixMs(1_730_000_200_000),
  };
}

function createCommitDeliveryParams(): CommitDeliveryParams {
  return {
    cipherBundle: createCipherBundle(),
    deliveredAt: asUnixMs(1_730_000_300_000),
  };
}

function createUpdateIntent(
  uuid: UUID,
  version: number,
  timestamp: UnixMs,
  nonce: Base64Url,
  receiverPubFpr: HexString
): UpdateIntent {
  return {
    op: 'update',
    uuid,
    version,
    timestamp,
    nonce,
    receiverPubFpr,
    cipherBundle: createCipherBundle(),
    expireAt: null,
  };
}

function createDeleteIntent(
  uuid: UUID,
  version: number,
  timestamp: UnixMs,
  nonce: Base64Url
): DeleteIntent {
  return {
    op: 'delete',
    uuid,
    version,
    timestamp,
    nonce,
  };
}

const FIXTURE_CREATED_AT = asUnixMs(1_900_000_000_000);
const FIXTURE_EXPIRES_AT = asUnixMs(1_900_000_000_000 + CHANNEL_TTL_MS.ONE_DAY);

function createChannelRecord(
  state: ChannelState = CHANNEL_STATE.WAITING,
  adminMode: 'webauthn' | 'softkey' = 'webauthn'
): ChannelRecord {
  return {
    uuid: asUuid('abcdefghijklmnopqrstu'),
    state,
    createdAt: FIXTURE_CREATED_AT,
    expiresAt: FIXTURE_EXPIRES_AT,
    ttl: CHANNEL_TTL_MS.ONE_DAY,
    securityProfile: SECURITY_PROFILE.STANDARD,
    adminMode,
    adminCredential:
      adminMode === 'softkey'
        ? {
            type: 'softkey',
            softkeyPubJwk: {
              kty: 'EC',
              crv: 'P-256',
              x: asBase64Url('softkeyx'),
              y: asBase64Url('softkeyy'),
              ext: true,
              key_ops: ['verify'],
            },
          }
        : {
            credentialId: asBase64Url('credential-id'),
            publicKey: asBase64Url('public-key'),
            signCount: 1,
            aaguid: asBase64Url('aaguid-value'),
          },
    lockKey: createLockKey(),
    version: 0,
  };
}

function createMockState(initialRecord?: ChannelRecord): {
  state: DurableObjectState;
  snapshot: Map<string, unknown>;
  getAlarm: () => number | null;
  getAcceptedWebSocketCount: () => number;
} {
  const snapshot = new Map<string, unknown>();
  let scheduledAlarm: number | null = null;
  let acceptedWebSocketCount = 0;
  if (initialRecord) {
    snapshot.set(CHANNEL_RECORD_KEY, structuredClone(initialRecord));
  }

  const storage = {
    async get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> {
      if (Array.isArray(key)) {
        const values = new Map<string, T>();
        for (const entryKey of key) {
          if (snapshot.has(entryKey)) {
            values.set(entryKey, snapshot.get(entryKey) as T);
          }
        }
        return values;
      }

      return snapshot.get(key) as T | undefined;
    },
    async list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>> {
      let keys = [...snapshot.keys()];
      const prefix = options?.prefix;
      const start = options?.start;
      const startAfter = options?.startAfter;
      const end = options?.end;
      const reverse = options?.reverse ?? false;
      const limit = options?.limit;

      if (prefix !== undefined) {
        keys = keys.filter((key) => key.startsWith(prefix));
      }

      keys.sort((left, right) => left.localeCompare(right));

      keys = keys.filter((key) => {
        if (start !== undefined) {
          if (!reverse && key < start) {
            return false;
          }
          if (reverse && key > start) {
            return false;
          }
        }

        if (startAfter !== undefined) {
          if (!reverse && key <= startAfter) {
            return false;
          }
          if (reverse && key >= startAfter) {
            return false;
          }
        }

        if (end !== undefined) {
          if (!reverse && key >= end) {
            return false;
          }
          if (reverse && key <= end) {
            return false;
          }
        }

        return true;
      });

      if (reverse) {
        keys.reverse();
      }

      if (typeof limit === 'number') {
        keys = keys.slice(0, limit);
      }

      const listed = new Map<string, T>();
      for (const key of keys) {
        listed.set(key, snapshot.get(key) as T);
      }
      return listed;
    },
    async put<T>(key: string | Record<string, T>, value?: T): Promise<void> {
      if (typeof key === 'string') {
        snapshot.set(key, structuredClone(value));
        return;
      }

      for (const [entryKey, entryValue] of Object.entries(key)) {
        snapshot.set(entryKey, structuredClone(entryValue));
      }
    },
    async delete(key: string | string[]): Promise<boolean | number> {
      if (Array.isArray(key)) {
        let deleted = 0;
        for (const entryKey of key) {
          if (snapshot.delete(entryKey)) {
            deleted += 1;
          }
        }
        return deleted;
      }

      return snapshot.delete(key);
    },
    async getAlarm(): Promise<number | null> {
      return scheduledAlarm;
    },
    async setAlarm(scheduledTime: number | Date): Promise<void> {
      scheduledAlarm = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
    },
    async deleteAlarm(): Promise<void> {
      scheduledAlarm = null;
    },
  } as unknown as DurableObjectStorage;

  const state = {
    waitUntil(_promise: Promise<unknown>): void {},
    props: {},
    id: {} as DurableObjectId,
    storage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => callback(),
    // WebSocket Hibernation API mocks
    getWebSockets(_tag?: string): WebSocket[] {
      return [];
    },
    getTags(_ws: WebSocket): string[] {
      return [];
    },
    acceptWebSocket(_ws: WebSocket, _tags?: string[]): void {
      acceptedWebSocketCount += 1;
    },
    setWebSocketAutoResponse(_pair: WebSocketRequestResponsePair | null): void {},
  } as unknown as DurableObjectState;

  return {
    state,
    snapshot,
    getAlarm: () => scheduledAlarm,
    getAcceptedWebSocketCount: () => acceptedWebSocketCount,
  };
}

const RP_ID = 'zerolink.test';
const RP_ORIGIN = 'https://zerolink.test';

const env: SecretVaultEnv = {
  SECRET_VAULT: {} as DurableObjectNamespace,
  SECRETS_KV: {} as KVNamespace,
  APP_ENV: 'test',
  RP_ID,
  RP_ORIGIN,
};

function expectStateTransitionError(
  operation: () => ChannelRecord,
  expectedCode: StateTransitionError['code']
): void {
  try {
    operation();
    throw new Error('expected StateTransitionError');
  } catch (error) {
    expect(error).toBeInstanceOf(StateTransitionError);
    if (error instanceof StateTransitionError) {
      expect(error.code).toBe(expectedCode);
    }
  }
}

async function computeLockProof(
  uuid: UUID,
  challenge: LockChallenge,
  lockKey: Base64Url
): Promise<HexString> {
  return sha256Hex([
    toUtf8Bytes(DOMAIN.LOCK_PROOF),
    toUtf8Bytes(uuid),
    decodeBase64Url(challenge.id),
    decodeBase64Url(challenge.challenge),
    decodeBase64Url(lockKey),
  ]);
}

function createAssertionFixture(credentialId: Base64Url): AssertionJSON {
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: asBase64Url('client_data'),
      authenticatorData: asBase64Url('auth_data'),
      signature: asBase64Url('signature_data'),
      userHandle: null,
    },
  };
}

function createNonceIndexKey(expiresAt: UnixMs, nonce: Base64Url): string {
  return `${NONCE_INDEX_KEY_PREFIX}${String(expiresAt).padStart(16, '0')}:${nonce}`;
}

function readTerminalTombstone(
  snapshot: Map<string, unknown>
): StoredTerminalTombstone | undefined {
  return snapshot.get(TERMINAL_TOMBSTONE_KEY) as StoredTerminalTombstone | undefined;
}

async function computeCompoundChallengeValue(
  uuid: UUID,
  challengeId: Base64Url,
  intentHash: HexString,
  seed: Base64Url
): Promise<Base64Url> {
  const challengeHashHex = await sha256Hex([
    toUtf8Bytes(DOMAIN.CHALLENGE),
    toUtf8Bytes(uuid),
    decodeBase64Url(challengeId),
    toUtf8Bytes(intentHash),
    decodeBase64Url(seed),
  ]);

  return encodeBase64Url(hexToBytes(challengeHashHex));
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }

  return bytes;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe('SecretVaultStateMachine', () => {
  it('transitions waiting to locked with receiver identity set', () => {
    const waiting = createChannelRecord(CHANNEL_STATE.WAITING);
    const machine = new SecretVaultStateMachine(waiting);
    const locked = machine.commitLock(createCommitLockParams());

    expect(locked.state).toBe(CHANNEL_STATE.LOCKED);
    expect(locked.receiver?.pubFpr).toBe(createCommitLockParams().receiverPubFpr);
    expect(waiting.state).toBe(CHANNEL_STATE.WAITING);
    expect(waiting.receiver).toBeUndefined();
  });

  it('transitions locked to delivered and increments version', () => {
    const lockParams = createCommitLockParams();
    const locked = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const machine = new SecretVaultStateMachine(locked);
    const delivered = machine.commitDelivery(createCommitDeliveryParams());

    expect(delivered.state).toBe(CHANNEL_STATE.DELIVERED);
    expect(delivered.version).toBe(1);
    expect(delivered.cipherBundle).toEqual(createCommitDeliveryParams().cipherBundle);
  });

  it('supports delivered to delivered update transition and increments version again', () => {
    const lockParams = createCommitLockParams();
    const firstDeliveryParams = createCommitDeliveryParams();
    const locked = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const delivered = new SecretVaultStateMachine(locked).commitDelivery(firstDeliveryParams);

    const secondDelivery = new SecretVaultStateMachine(delivered).commitDelivery({
      ...firstDeliveryParams,
      deliveredAt: asUnixMs(1_730_000_400_000),
    });

    expect(secondDelivery.state).toBe(CHANNEL_STATE.DELIVERED);
    expect(secondDelivery.version).toBe(2);
    expect(secondDelivery.deliveredAt).toBe(asUnixMs(1_730_000_400_000));
  });

  it('transitions delivered to deleted', () => {
    const lockParams = createCommitLockParams();
    const deliveryParams = createCommitDeliveryParams();
    const locked = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const delivered = new SecretVaultStateMachine(locked).commitDelivery(deliveryParams);
    const deleted = new SecretVaultStateMachine(delivered).commitDelete();

    expect(deleted.state).toBe(CHANNEL_STATE.DELETED);
  });

  it('transitions waiting to expired', () => {
    const expired = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).expire();
    expect(expired.state).toBe(CHANNEL_STATE.EXPIRED);
  });

  it('rejects commitLock from locked state', () => {
    const locked = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(createCommitLockParams());
    expectStateTransitionError(
      () => new SecretVaultStateMachine(locked).commitLock(createCommitLockParams()),
      'INVALID_TRANSITION'
    );
  });

  it('rejects writes after deleted state', () => {
    const deleted = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitDelete();
    expectStateTransitionError(
      () => new SecretVaultStateMachine(deleted).commitDelivery(createCommitDeliveryParams()),
      'TERMINAL_STATE'
    );
  });
});

describe('SecretVault lock challenge flow', () => {
  it('initializes and reads the stored channel record', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const record = createChannelRecord(CHANNEL_STATE.WAITING);

    await vault.initialize(record);
    const loaded = await vault.getRecord();

    expect(loaded).toEqual(record);
  });

  it('issues and stores lock challenge on beginLockChallenge', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);

    const challenge = await vault.beginLockChallenge(record.uuid, now);
    const storedChallenge = snapshot.get(LOCK_CHALLENGE_KEY) as LockChallenge;

    expect(challenge.expiresAt).toBe(asUnixMs(now + CHALLENGE_TTL_MS));
    expect(storedChallenge.id).toBe(challenge.id);
    expect(decodeBase64Url(challenge.challenge).byteLength).toBe(32);
  });

  it('returns the existing active lock challenge without overwriting it', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);

    const firstChallenge = await vault.beginLockChallenge(record.uuid, now);
    const secondChallenge = await vault.beginLockChallenge(record.uuid, now + 1_000);

    expect(secondChallenge).toEqual(firstChallenge);
    expect(snapshot.get(LOCK_CHALLENGE_KEY)).toMatchObject({
      id: firstChallenge.id,
      challenge: firstChallenge.challenge,
      expiresAt: firstChallenge.expiresAt,
    });
  });

  it('issues a new lock challenge after the previous one is consumed', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);

    const firstChallenge = await vault.beginLockChallenge(record.uuid, now);
    snapshot.set(LOCK_CHALLENGE_KEY, {
      ...(snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge),
      consumedAt: asUnixMs(now + 500),
    });

    const secondChallenge = await vault.beginLockChallenge(record.uuid, now + 1_000);

    expect(secondChallenge.id).not.toBe(firstChallenge.id);
    expect(secondChallenge.challenge).not.toBe(firstChallenge.challenge);
  });

  it('issues a new lock challenge after the previous one expires', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);

    const firstChallenge = await vault.beginLockChallenge(record.uuid, now);
    snapshot.set(LOCK_CHALLENGE_KEY, {
      ...(snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge),
      expiresAt: asUnixMs(now + 500),
    });

    const secondChallenge = await vault.beginLockChallenge(record.uuid, now + CHALLENGE_TTL_MS + 1);

    expect(secondChallenge.id).not.toBe(firstChallenge.id);
    expect(secondChallenge.challenge).not.toBe(firstChallenge.challenge);
  });

  it('commits lock challenge successfully and transitions waiting to locked', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now);
    const lockProof = await computeLockProof(record.uuid, challenge, record.lockKey);
    const commitParams: CommitLockChallengeParams = {
      uuid: record.uuid,
      lockChallengeId: challenge.id,
      lockProof,
      receiverPubJwk: lockParams.receiverPubJwk,
      receiverPubFpr: lockParams.receiverPubFpr,
      lockedAt: lockParams.lockedAt,
    };

    await vault.commitLockChallenge(commitParams, now + 1_000);

    const updated = await vault.getRecord();
    const storedChallenge = snapshot.get(LOCK_CHALLENGE_KEY) as {
      consumedAt?: UnixMs;
    };
    expect(updated.state).toBe(CHANNEL_STATE.LOCKED);
    expect(updated.receiver?.pubFpr).toBe(lockParams.receiverPubFpr);
    expect(storedChallenge.consumedAt).toBeDefined();
  });

  it('commits lock challenge from a legacy pre-deploy challenge record', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now);
    const lockProof = await computeLockProof(record.uuid, challenge, record.lockKey);
    const storedChallenge = snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge;

    snapshot.set(legacyLockChallengeStorageKey(challenge.id), storedChallenge);
    snapshot.delete(LOCK_CHALLENGE_KEY);

    await vault.commitLockChallenge(
      {
        uuid: record.uuid,
        lockChallengeId: challenge.id,
        lockProof,
        receiverPubJwk: lockParams.receiverPubJwk,
        receiverPubFpr: lockParams.receiverPubFpr,
        lockedAt: lockParams.lockedAt,
      },
      now + 1_000
    );

    const updated = await vault.getRecord();
    const consumedLegacyChallenge = snapshot.get(
      legacyLockChallengeStorageKey(challenge.id)
    ) as StoredLockChallenge;

    expect(updated.state).toBe(CHANNEL_STATE.LOCKED);
    expect(updated.receiver?.pubFpr).toBe(lockParams.receiverPubFpr);
    expect(consumedLegacyChallenge.consumedAt).toBeDefined();
  });

  it('rejects commit when challenge is missing', async () => {
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);

    await expect(
      vault.commitLockChallenge({
        uuid: record.uuid,
        lockChallengeId: asBase64Url('missing-id'),
        lockProof: asHex('00'),
        receiverPubJwk: lockParams.receiverPubJwk,
        receiverPubFpr: lockParams.receiverPubFpr,
        lockedAt: lockParams.lockedAt,
      })
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
  });

  it('rejects commit when a legacy challenge is expired and deletes it', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now);
    const lockProof = await computeLockProof(record.uuid, challenge, record.lockKey);
    const legacyKey = legacyLockChallengeStorageKey(challenge.id);

    snapshot.set(legacyKey, {
      ...(snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge),
      expiresAt: asUnixMs(now + 500),
    });
    snapshot.delete(LOCK_CHALLENGE_KEY);

    await expect(
      vault.commitLockChallenge(
        {
          uuid: record.uuid,
          lockChallengeId: challenge.id,
          lockProof,
          receiverPubJwk: lockParams.receiverPubJwk,
          receiverPubFpr: lockParams.receiverPubFpr,
          lockedAt: lockParams.lockedAt,
        },
        now + CHALLENGE_TTL_MS + 1
      )
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
    expect(snapshot.get(legacyKey)).toBeUndefined();
  });

  it('rejects commit when challenge is expired', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now);
    const lockProof = await computeLockProof(record.uuid, challenge, record.lockKey);

    await expect(
      vault.commitLockChallenge(
        {
          uuid: record.uuid,
          lockChallengeId: challenge.id,
          lockProof,
          receiverPubJwk: lockParams.receiverPubJwk,
          receiverPubFpr: lockParams.receiverPubFpr,
          lockedAt: lockParams.lockedAt,
        },
        now + CHALLENGE_TTL_MS + 1
      )
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
    expect(snapshot.get(LOCK_CHALLENGE_KEY)).toBeUndefined();
  });

  it('rejects commit when request id does not match the active challenge id', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now);
    const lockProof = await computeLockProof(record.uuid, challenge, record.lockKey);

    await expect(
      vault.commitLockChallenge(
        {
          uuid: record.uuid,
          lockChallengeId: asBase64Url('different-id'),
          lockProof,
          receiverPubJwk: lockParams.receiverPubJwk,
          receiverPubFpr: lockParams.receiverPubFpr,
          lockedAt: lockParams.lockedAt,
        },
        now + 1_000
      )
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
  });

  it('rejects replay commit for consumed challenge', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now);
    const lockProof = await computeLockProof(record.uuid, challenge, record.lockKey);
    const params: CommitLockChallengeParams = {
      uuid: record.uuid,
      lockChallengeId: challenge.id,
      lockProof,
      receiverPubJwk: lockParams.receiverPubJwk,
      receiverPubFpr: lockParams.receiverPubFpr,
      lockedAt: lockParams.lockedAt,
    };

    const storedChallenge = snapshot.get(LOCK_CHALLENGE_KEY) as {
      id: Base64Url;
      challenge: Base64Url;
      expiresAt: UnixMs;
    };
    snapshot.set(LOCK_CHALLENGE_KEY, {
      ...storedChallenge,
      consumedAt: asUnixMs(now + 500),
    });

    await expect(vault.commitLockChallenge(params, now + 1_000)).rejects.toMatchObject({
      code: 'CHALLENGE_CONSUMED',
    });
  });

  it('rejects replay commit for a consumed legacy challenge', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now);
    const lockProof = await computeLockProof(record.uuid, challenge, record.lockKey);
    const legacyKey = legacyLockChallengeStorageKey(challenge.id);

    snapshot.set(legacyKey, {
      ...(snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge),
      consumedAt: asUnixMs(now + 500),
    });
    snapshot.delete(LOCK_CHALLENGE_KEY);

    await expect(
      vault.commitLockChallenge(
        {
          uuid: record.uuid,
          lockChallengeId: challenge.id,
          lockProof,
          receiverPubJwk: lockParams.receiverPubJwk,
          receiverPubFpr: lockParams.receiverPubFpr,
          lockedAt: lockParams.lockedAt,
        },
        now + 1_000
      )
    ).rejects.toMatchObject({ code: 'CHALLENGE_CONSUMED' });
  });

  it('rejects commit when lock proof is invalid', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now);

    await expect(
      vault.commitLockChallenge(
        {
          uuid: record.uuid,
          lockChallengeId: challenge.id,
          lockProof: asHex('00'),
          receiverPubJwk: lockParams.receiverPubJwk,
          receiverPubFpr: lockParams.receiverPubFpr,
          lockedAt: lockParams.lockedAt,
        },
        now + 1_000
      )
    ).rejects.toMatchObject({ code: 'LOCK_FORBIDDEN' });
  });

  // PRD §14.1 — TOFU preemption: an attacker who does not know the lock_secret
  // can still compute a structurally valid SHA-256 proof (correct domain, uuid,
  // challenge id, and challenge bytes) but uses a wrong lockKey. The server must
  // reject it with LOCK_FORBIDDEN because the proof will not match the stored
  // lockKey on the channel record.
  it('rejects lock_commit from attacker who does not know lock_secret (PRD §14.1 TOFU preemption)', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);

    // Step 1: begin challenge (same as the honest flow)
    const challenge = await vault.beginLockChallenge(record.uuid, now);

    // Step 2: attacker uses a guessed lockKey that differs from record.lockKey.
    // The attacker still calls computeLockProof, so the proof is structurally
    // valid (correct HMAC domain, correct uuid, correct challenge bytes) but
    // is computed over the wrong key material.
    // Use encodeBase64Url to produce a properly-encoded key with different bytes
    // than the real lockKey. Use 32 bytes (LOCK_KEY_BYTES) of 0xff to model
    // a realistic attacker who guesses the full-length key material.
    const attackerLockKey = encodeBase64Url(new Uint8Array(32).fill(0xff));
    const attackerProof = await computeLockProof(record.uuid, challenge, attackerLockKey);

    // Step 3: submit the attacker's structurally-valid-but-wrong proof
    await expect(
      vault.commitLockChallenge(
        {
          uuid: record.uuid,
          lockChallengeId: challenge.id,
          lockProof: attackerProof,
          receiverPubJwk: lockParams.receiverPubJwk,
          receiverPubFpr: lockParams.receiverPubFpr,
          lockedAt: lockParams.lockedAt,
        },
        now + 1_000
      )
    ).rejects.toMatchObject({ code: 'LOCK_FORBIDDEN' });
  });

  it('rejects lock_commit when receiverPubFpr does not match JWK fingerprint (M-1)', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now);
    const lockProof = await computeLockProof(record.uuid, challenge, record.lockKey);

    await expect(
      vault.commitLockChallenge(
        {
          uuid: record.uuid,
          lockChallengeId: challenge.id,
          lockProof,
          receiverPubJwk: lockParams.receiverPubJwk,
          receiverPubFpr: asHex('0000000000000000000000000000000000000000000000000000000000000000'),
          lockedAt: lockParams.lockedAt,
        },
        now + 1_000
      )
    ).rejects.toThrow('receiverPubFpr does not match');
  });

  it('rate limits new lock challenge issuance while allowing idempotent reuse', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);

    const firstChallenge = await vault.beginLockChallenge(record.uuid, now);
    await expect(vault.beginLockChallenge(record.uuid, now + 1_000)).resolves.toEqual(
      firstChallenge
    );
    await expect(vault.beginLockChallenge(record.uuid, now + 2_000)).resolves.toEqual(
      firstChallenge
    );
    await expect(vault.beginLockChallenge(record.uuid, now + 3_000)).resolves.toEqual(
      firstChallenge
    );

    snapshot.set(LOCK_CHALLENGE_KEY, {
      ...(snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge),
      consumedAt: asUnixMs(now + 4_000),
    });
    const secondChallenge = await vault.beginLockChallenge(record.uuid, now + 5_000);
    snapshot.set(LOCK_CHALLENGE_KEY, {
      ...(snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge),
      consumedAt: asUnixMs(now + 6_000),
    });
    const thirdChallenge = await vault.beginLockChallenge(record.uuid, now + 7_000);
    snapshot.set(LOCK_CHALLENGE_KEY, {
      ...(snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge),
      consumedAt: asUnixMs(now + 8_000),
    });

    const error = await vault
      .beginLockChallenge(record.uuid, now + 9_000)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(secondChallenge.id).not.toBe(firstChallenge.id);
    expect(thirdChallenge.id).not.toBe(secondChallenge.id);

    await expect(vault.beginLockChallenge(record.uuid, now + 60_001)).resolves.toMatchObject({
      expiresAt: asUnixMs(now + 60_001 + CHALLENGE_TTL_MS),
    });
  });

  it('does not spend lock_commit quota before a valid challenge is resolved', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);

    const missingChallengeParams: CommitLockChallengeParams = {
      uuid: record.uuid,
      lockChallengeId: asBase64Url('missing-id'),
      lockProof: asHex('00'),
      receiverPubJwk: lockParams.receiverPubJwk,
      receiverPubFpr: lockParams.receiverPubFpr,
      lockedAt: lockParams.lockedAt,
    };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(
        vault.commitLockChallenge(missingChallengeParams, now + attempt)
      ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
    }

    const challenge = await vault.beginLockChallenge(record.uuid, now + 10_000);
    const bruteForceParams: CommitLockChallengeParams = {
      uuid: record.uuid,
      lockChallengeId: challenge.id,
      lockProof: asHex('00'),
      receiverPubJwk: lockParams.receiverPubJwk,
      receiverPubFpr: lockParams.receiverPubFpr,
      lockedAt: lockParams.lockedAt,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        vault.commitLockChallenge(bruteForceParams, now + 11_000 + attempt)
      ).rejects.toMatchObject({ code: 'LOCK_FORBIDDEN' });
    }

    const error = await vault
      .commitLockChallenge(bruteForceParams, now + 17_000)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
  });

  it('rate limits lock_commit and resets after the window elapses', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now);
    const baseParams: CommitLockChallengeParams = {
      uuid: record.uuid,
      lockChallengeId: challenge.id,
      lockProof: asHex('00'),
      receiverPubJwk: lockParams.receiverPubJwk,
      receiverPubFpr: lockParams.receiverPubFpr,
      lockedAt: lockParams.lockedAt,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(vault.commitLockChallenge(baseParams, now + attempt + 1)).rejects.toMatchObject({
        code: 'LOCK_FORBIDDEN',
      });
    }

    const error = await vault
      .commitLockChallenge(baseParams, now + 6_000)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBeGreaterThanOrEqual(1);

    const nextChallenge = await vault.beginLockChallenge(record.uuid, now + 60_001);
    await expect(
      vault.commitLockChallenge(
        {
          ...baseParams,
          lockChallengeId: nextChallenge.id,
        },
        now + 60_002
      )
    ).rejects.toMatchObject({ code: 'LOCK_FORBIDDEN' });
  });

  it('rate limits new compound challenge issuance while allowing active challenge reuse', async () => {
    const now = 1_730_001_000_000;
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(createCommitLockParams());
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);

    const firstBegin = await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    await expect(vault.beginCompoundChallenge(lockedRecord.uuid, now + 1_000)).resolves.toEqual(
      firstBegin
    );
    await expect(vault.beginCompoundChallenge(lockedRecord.uuid, now + 2_000)).resolves.toEqual(
      firstBegin
    );
    await expect(vault.beginCompoundChallenge(lockedRecord.uuid, now + 3_000)).resolves.toEqual(
      firstBegin
    );

    snapshot.set(COMPOUND_CHALLENGE_KEY, {
      ...(snapshot.get(COMPOUND_CHALLENGE_KEY) as StoredCompoundChallenge),
      consumedAt: asUnixMs(now + 4_000),
    });
    const secondBegin = await vault.beginCompoundChallenge(lockedRecord.uuid, now + 5_000);
    snapshot.set(COMPOUND_CHALLENGE_KEY, {
      ...(snapshot.get(COMPOUND_CHALLENGE_KEY) as StoredCompoundChallenge),
      consumedAt: asUnixMs(now + 6_000),
    });
    const thirdBegin = await vault.beginCompoundChallenge(lockedRecord.uuid, now + 7_000);
    snapshot.set(COMPOUND_CHALLENGE_KEY, {
      ...(snapshot.get(COMPOUND_CHALLENGE_KEY) as StoredCompoundChallenge),
      consumedAt: asUnixMs(now + 8_000),
    });

    const error = await vault
      .beginCompoundChallenge(lockedRecord.uuid, now + 9_000)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(secondBegin.challenge.id).not.toBe(firstBegin.challenge.id);
    expect(thirdBegin.challenge.id).not.toBe(secondBegin.challenge.id);

    await expect(
      vault.beginCompoundChallenge(lockedRecord.uuid, now + 60_001)
    ).resolves.toMatchObject({
      currentVersion: lockedRecord.version,
    });
  });

  it('does not spend compound_commit quota before integrity checks pass', async () => {
    const now = 1_730_001_850_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING, 'softkey')
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const verifySoftkeySignatureMock = vi.mocked(softkeyCrypto.verifySoftkeySignature);
    verifySoftkeySignatureMock.mockResolvedValue({
      ok: false,
      error: 'bad softkey signature',
    });

    await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const invalidIntent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version + 1,
      asUnixMs(now + 1_000),
      asBase64Url('nonce_bad_version'),
      lockParams.receiverPubFpr
    );
    const invalidIntentHash = await computeIntentHash(toRecord(invalidIntent));

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await expect(
        vault.commitCompound(
          {
            adminMode: 'softkey',
            uuid: lockedRecord.uuid,
            softkeySignature: asHex(
              'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef'
            ),
            intentHash: invalidIntentHash,
            intent: invalidIntent,
          },
          now + 1_000 + attempt
        )
      ).rejects.toMatchObject({ code: 'VERSION_MISMATCH' });
    }

    const validIntent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + 20_000),
      asBase64Url('nonce_valid_version'),
      lockParams.receiverPubFpr
    );
    const validIntentHash = await computeIntentHash(toRecord(validIntent));
    const bruteForceParams = {
      adminMode: 'softkey' as const,
      uuid: lockedRecord.uuid,
      softkeySignature: asHex(
        'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef'
      ),
      intentHash: validIntentHash,
      intent: validIntent,
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        vault.commitCompound(bruteForceParams, now + 20_000 + attempt)
      ).rejects.toMatchObject({ code: 'ASSERTION_INVALID' });
    }

    const error = await vault
      .commitCompound(bruteForceParams, now + 31_000)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    verifySoftkeySignatureMock.mockReset();
  });

  it('rate limits compound_commit and resets after the window elapses', async () => {
    const now = 1_730_001_900_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING, 'softkey')
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const verifySoftkeySignatureMock = vi.mocked(softkeyCrypto.verifySoftkeySignature);
    verifySoftkeySignatureMock.mockResolvedValue({
      ok: false,
      error: 'bad softkey signature',
    });

    const firstBegin = await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const firstIntent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + 1_000),
      asBase64Url('nonce_rate_limit_01'),
      lockParams.receiverPubFpr
    );
    const firstIntentHash = await computeIntentHash(toRecord(firstIntent));
    const baseParams = {
      adminMode: 'softkey' as const,
      uuid: lockedRecord.uuid,
      softkeySignature: asHex(
        'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef'
      ),
      intentHash: firstIntentHash,
      intent: firstIntent,
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(vault.commitCompound(baseParams, now + attempt + 1)).rejects.toMatchObject({
        code: 'ASSERTION_INVALID',
      });
    }

    const error = await vault.commitCompound(baseParams, now + 11_000).catch((caught) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBeGreaterThanOrEqual(1);

    const nextBegin = await vault.beginCompoundChallenge(lockedRecord.uuid, now + 60_001);
    const nextIntent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + 61_000),
      asBase64Url('nonce_rate_limit_02'),
      lockParams.receiverPubFpr
    );
    const nextIntentHash = await computeIntentHash(toRecord(nextIntent));

    await expect(
      vault.commitCompound(
        {
          adminMode: 'softkey',
          uuid: lockedRecord.uuid,
          softkeySignature: baseParams.softkeySignature,
          intentHash: nextIntentHash,
          intent: nextIntent,
        },
        now + 61_000
      )
    ).rejects.toMatchObject({ code: 'ASSERTION_INVALID' });

    expect(firstBegin.challenge.id).not.toBe(nextBegin.challenge.id);
    verifySoftkeySignatureMock.mockReset();
  });

  it('returns 405 for non-POST method in fetch', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);

    const response = await vault.fetch(
      new Request('https://zerolink.test/lock_begin', { method: 'GET' })
    );
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(405);
    expect(payload).toEqual({
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
    });
  });

  it('returns 404 for unknown fetch path', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);

    const response = await vault.fetch(
      new Request('https://zerolink.test/unknown_path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('rejects websocket upgrade when channel record is missing', async () => {
    const { state, getAcceptedWebSocketCount } = createMockState();
    const vault = new SecretVault(state, env);

    const response = await vault.fetch(
      new Request('https://zerolink.test/ws', {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      })
    );
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(404);
    expect(payload).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(getAcceptedWebSocketCount()).toBe(0);
  });

  it('rejects websocket upgrade when channel record is already expired', async () => {
    const now = 1_730_001_455_000;
    const expiredRecord = {
      ...createChannelRecord(CHANNEL_STATE.LOCKED),
      expiresAt: asUnixMs(now - 1),
    };
    const { state, getAcceptedWebSocketCount, snapshot } = createMockState(expiredRecord);
    const vault = new SecretVault(state, env);

    const response = await vault.fetch(
      new Request('https://zerolink.test/ws', {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      })
    );
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(404);
    expect(payload).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(getAcceptedWebSocketCount()).toBe(0);
    expect(snapshot.get(CHANNEL_RECORD_KEY)).toBeUndefined();
    expect(readTerminalTombstone(snapshot)?.reason).toBe('expired');
  });

  it('redacts unexpected websocket upgrade errors through the top-level fetch guard', async () => {
    const { state, getAcceptedWebSocketCount } = createMockState();
    const storage = state.storage as unknown as {
      get: (key: string | string[]) => Promise<unknown>;
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const storageGet = vi.spyOn(storage, 'get');
    const error = new Error('sensitive websocket failure');
    error.stack = [
      'Error: sensitive websocket failure',
      '    at https://prod.example.com/assets/index-123abc456.js:10:20',
      '    at websocketSubscribe (https://prod.example.com/assets/chunk-123abc456.js:30:40)',
    ].join('\n');
    storageGet.mockRejectedValue(error);

    try {
      const productionEnv: SecretVaultEnv = { ...env, APP_ENV: 'production' };
      const vault = new SecretVault(state, productionEnv);

      const response = await vault.fetch(
        new Request('https://zerolink.test/ws', {
          method: 'GET',
          headers: { Upgrade: 'websocket' },
        })
      );
      const payload = (await response.json()) as { ok: false; code: string };
      const logEntry = consoleError.mock.calls[0]?.[0] as Record<string, unknown>;

      expect(response.status).toBe(500);
      expect(payload).toEqual({ ok: false, code: 'INTERNAL_ERROR' });
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(logEntry).toMatchObject({
        event: 'secret_vault.unexpected_error',
        app_env: 'production',
        handler: 'ws_subscribe',
        error_name: 'Error',
        stack_fingerprint: expect.any(String),
      });
      expect(logEntry).not.toHaveProperty('error_message');
      expect(logEntry).not.toHaveProperty('error_stack');
      expect(getAcceptedWebSocketCount()).toBe(0);
    } finally {
      storageGet.mockRestore();
      consoleError.mockRestore();
    }
  });

  it('returns 400 for invalid lock_begin payload', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);

    const response = await vault.fetch(
      new Request('https://zerolink.test/lock_begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: 'invalid' }),
      })
    );
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      ok: false,
      code: 'BAD_REQUEST',
    });
  });
});

describe('SecretVault compound/delete flow', () => {
  it('issues and stores compound challenge with current version, receiver info, and adminMode', async () => {
    const now = 1_730_001_000_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);

    const result = await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const storedChallenge = snapshot.get(COMPOUND_CHALLENGE_KEY) as {
      id: Base64Url;
      seed: Base64Url;
      expiresAt: UnixMs;
    };

    expect(result.currentVersion).toBe(lockedRecord.version);
    expect(result.securityProfile).toBe(lockedRecord.securityProfile);
    expect(result.adminMode).toBe(lockedRecord.adminMode);
    expect(result.allowCredentials).toEqual([
      {
        id: (lockedRecord.adminCredential as StoredCredential).credentialId,
        type: 'public-key',
      },
    ]);
    expect(result.receiverPubFpr).toBe(lockParams.receiverPubFpr);
    expect(result.receiverPubJwk).toEqual(lockParams.receiverPubJwk);
    expect(result.challenge.id).toBe(storedChallenge.id);
    expect(result.challenge.seed).toBe(storedChallenge.seed);
    expect(result.challenge.expiresAt).toBe(asUnixMs(now + CHALLENGE_TTL_MS));
  });

  it('omits allowCredentials for softkey-managed channels', async () => {
    const now = 1_730_001_050_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING, 'softkey')
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);

    const result = await vault.beginCompoundChallenge(lockedRecord.uuid, now);

    expect(result.securityProfile).toBe(lockedRecord.securityProfile);
    expect(result.adminMode).toBe('softkey');
    expect(result.allowCredentials).toBeUndefined();
  });

  it('returns the existing active compound challenge without overwriting it (M-3)', async () => {
    const now = 1_730_001_000_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);

    const firstChallenge = await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const secondChallenge = await vault.beginCompoundChallenge(lockedRecord.uuid, now + 1_000);

    expect(secondChallenge).toEqual(firstChallenge);
    expect(snapshot.get(COMPOUND_CHALLENGE_KEY)).toMatchObject({
      id: firstChallenge.challenge.id,
      seed: firstChallenge.challenge.seed,
      expiresAt: firstChallenge.challenge.expiresAt,
    });
  });

  it('issues a new compound challenge after the previous one is consumed', async () => {
    const now = 1_730_001_000_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);

    const firstChallenge = await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    snapshot.set(COMPOUND_CHALLENGE_KEY, {
      ...(snapshot.get(COMPOUND_CHALLENGE_KEY) as StoredCompoundChallenge),
      consumedAt: asUnixMs(now + 500),
    });

    const secondChallenge = await vault.beginCompoundChallenge(lockedRecord.uuid, now + 1_000);

    expect(secondChallenge.challenge.id).not.toBe(firstChallenge.challenge.id);
    expect(secondChallenge.challenge.seed).not.toBe(firstChallenge.challenge.seed);
  });

  it('issues a new compound challenge after the previous one expires', async () => {
    const now = 1_730_001_000_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);

    const firstChallenge = await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    snapshot.set(COMPOUND_CHALLENGE_KEY, {
      ...(snapshot.get(COMPOUND_CHALLENGE_KEY) as StoredCompoundChallenge),
      expiresAt: asUnixMs(now + 500),
    });

    const secondChallenge = await vault.beginCompoundChallenge(
      lockedRecord.uuid,
      now + CHALLENGE_TTL_MS + 1
    );

    expect(secondChallenge.challenge.id).not.toBe(firstChallenge.challenge.id);
    expect(secondChallenge.challenge.seed).not.toBe(firstChallenge.challenge.seed);
  });

  it('returns securityProfile on active public reads', async () => {
    const record = createChannelRecord(CHANNEL_STATE.LOCKED);
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);

    const response = await vault.fetch(
      new Request('https://zerolink.test/get_public_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    const payload = (await response.json()) as {
      ok: true;
      state: string;
      adminMode: string;
      securityProfile: string;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      state: record.state,
      adminMode: record.adminMode,
      securityProfile: record.securityProfile,
    });
  });

  it('commits update intent and transitions locked to delivered', async () => {
    const now = 1_730_001_100_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state, snapshot, getAlarm } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const begin = await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + 1_000),
      asBase64Url('nonce_update_01'),
      lockParams.receiverPubFpr
    );
    const intentHash = await computeIntentHash(toRecord(intent));
    const expectedChallenge = await computeCompoundChallengeValue(
      lockedRecord.uuid,
      begin.challenge.id,
      intentHash,
      begin.challenge.seed
    );
    const assertionFixture = await createMockAssertion({
      credentialId: (lockedRecord.adminCredential as StoredCredential).credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: expectedChallenge,
      signCount: 7,
    });

    snapshot.set(CHANNEL_RECORD_KEY, {
      ...lockedRecord,
      adminCredential: {
        ...lockedRecord.adminCredential,
        publicKey: assertionFixture.publicKeyCose,
        signCount: 3,
      },
    });

    const commitAt = now + 1_000;
    await vault.commitCompound(
      {
        uuid: lockedRecord.uuid,
        assertion: assertionFixture.assertion,
        intentHash,
        intent,
      },
      commitAt
    );

    const updated = await vault.getRecord();
    const nonceRecord = snapshot.get(`${NONCE_KEY_PREFIX}${intent.nonce}`) as {
      usedAt: UnixMs;
      expiresAt: UnixMs;
    };
    const nonceIndexKey = [...snapshot.keys()].find(
      (key) => key.startsWith(NONCE_INDEX_KEY_PREFIX) && key.endsWith(`:${intent.nonce}`)
    );
    const consumedChallenge = snapshot.get(COMPOUND_CHALLENGE_KEY) as {
      consumedAt?: UnixMs;
    };
    const expectedNonceExpiry = asUnixMs(commitAt + NONCE_TTL_MS);

    expect(updated.state).toBe(CHANNEL_STATE.DELIVERED);
    expect(updated.version).toBe(lockedRecord.version + 1);
    expect(updated.cipherBundle).toEqual(intent.cipherBundle);
    expect(updated.deliveredAt).toBe(intent.timestamp);
    expect((updated.adminCredential as StoredCredential).signCount).toBe(7);
    expect(nonceRecord.expiresAt).toBe(expectedNonceExpiry);
    expect(nonceIndexKey).toBe(createNonceIndexKey(expectedNonceExpiry, intent.nonce));
    expect(consumedChallenge.consumedAt).toBeDefined();
    expect(getAlarm()).toBe(Number(expectedNonceExpiry));
  });

  it('commits delete intent and physically purges channel storage', async () => {
    const now = 1_730_001_200_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const { state, snapshot, getAlarm } = createMockState(record);
    const vault = new SecretVault(state, env);
    const begin = await vault.beginCompoundChallenge(record.uuid, now);
    const intent = createDeleteIntent(
      record.uuid,
      record.version,
      asUnixMs(now + 1_000),
      asBase64Url('nonce_delete_01')
    );
    const intentHash = await computeIntentHash(toRecord(intent));
    const expectedChallenge = await computeCompoundChallengeValue(
      record.uuid,
      begin.challenge.id,
      intentHash,
      begin.challenge.seed
    );
    const assertionFixture = await createMockAssertion({
      credentialId: (record.adminCredential as StoredCredential).credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: expectedChallenge,
      signCount: 9,
    });

    snapshot.set(CHANNEL_RECORD_KEY, {
      ...record,
      adminCredential: {
        ...record.adminCredential,
        publicKey: assertionFixture.publicKeyCose,
      },
    });

    await vault.commitCompound(
      {
        uuid: record.uuid,
        assertion: assertionFixture.assertion,
        intentHash,
        intent,
      },
      now + 1_000
    );

    await expect(vault.getRecord()).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(vault.beginCompoundChallenge(record.uuid, now + 2_000)).rejects.toMatchObject({
      code: 'RECORD_NOT_FOUND',
    });
    await expect(vault.beginLockChallenge(record.uuid, now + 2_000)).rejects.toMatchObject({
      code: 'RECORD_NOT_FOUND',
    });
    const tombstone = readTerminalTombstone(snapshot);
    expect(snapshot.get(CHANNEL_RECORD_KEY)).toBeUndefined();
    expect(snapshot.get(COMPOUND_CHALLENGE_KEY)).toBeUndefined();
    expect(snapshot.get(`${NONCE_KEY_PREFIX}${intent.nonce}`)).toBeUndefined();
    expect(
      [...snapshot.keys()].find(
        (key) => key.startsWith(NONCE_INDEX_KEY_PREFIX) && key.endsWith(`:${intent.nonce}`)
      )
    ).toBeUndefined();
    expect([...snapshot.keys()]).toEqual([TERMINAL_TOMBSTONE_KEY]);
    expect(tombstone).toEqual({
      uuid: record.uuid,
      reason: 'deleted',
      finalizedAt: asUnixMs(now + 1_000),
    });
    expect(getAlarm()).toBeNull();
  });

  it('rejects compound commit with version mismatch', async () => {
    const now = 1_730_001_300_000;
    const record = createChannelRecord(CHANNEL_STATE.LOCKED);
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);
    const intent = createUpdateIntent(
      record.uuid,
      record.version + 1,
      asUnixMs(now),
      asBase64Url('nonce_vm_01'),
      asHex('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    );
    const intentHash = await computeIntentHash(toRecord(intent));

    await expect(
      vault.commitCompound(
        {
          uuid: record.uuid,
          assertion: createAssertionFixture(
            (record.adminCredential as StoredCredential).credentialId
          ),
          intentHash,
          intent,
        },
        now
      )
    ).rejects.toMatchObject({ code: 'VERSION_MISMATCH' });
  });

  it('rejects compound commit when intent receiverPubFpr mismatches locked receiver (M-2)', async () => {
    const now = 1_730_001_350_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const mismatchedFpr = asHex('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_m2_01'),
      mismatchedFpr
    );
    const intentHash = await computeIntentHash(toRecord(intent));

    await expect(
      vault.commitCompound(
        {
          uuid: lockedRecord.uuid,
          assertion: createAssertionFixture(
            (lockedRecord.adminCredential as StoredCredential).credentialId
          ),
          intentHash,
          intent,
        },
        now
      )
    ).rejects.toMatchObject({ code: 'LOCK_FORBIDDEN' });
  });

  it('rejects compound commit with nonce replay', async () => {
    const now = 1_730_001_400_000;
    const record = createChannelRecord(CHANNEL_STATE.LOCKED);
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);
    const intent = createUpdateIntent(
      record.uuid,
      record.version,
      asUnixMs(now),
      asBase64Url('nonce_replay_01'),
      asHex('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    );
    const intentHash = await computeIntentHash(toRecord(intent));
    snapshot.set(`${NONCE_KEY_PREFIX}${intent.nonce}`, {
      nonce: intent.nonce,
      usedAt: asUnixMs(now - 1),
      expiresAt: asUnixMs(now + NONCE_TTL_MS),
    });

    await expect(
      vault.commitCompound(
        {
          uuid: record.uuid,
          assertion: createAssertionFixture(
            (record.adminCredential as StoredCredential).credentialId
          ),
          intentHash,
          intent,
        },
        now
      )
    ).rejects.toMatchObject({ code: 'NONCE_REPLAY' });
  });

  it('alarm removes expired nonce keys and keeps active ones', async () => {
    const now = 1_730_001_450_000;
    const record = createChannelRecord(CHANNEL_STATE.LOCKED);
    const { state, snapshot, getAlarm } = createMockState(record);
    const vault = new SecretVault(state, env);

    const expiredNonce = asBase64Url('nonce_expired_01');
    const activeNonce = asBase64Url('nonce_active_01');
    const expiredAt = asUnixMs(now - 1_000);
    const activeAt = asUnixMs(now + 20_000);

    snapshot.set(`${NONCE_KEY_PREFIX}${expiredNonce}`, {
      nonce: expiredNonce,
      usedAt: asUnixMs(now - 2_000),
      expiresAt: expiredAt,
    });
    snapshot.set(`${NONCE_KEY_PREFIX}${activeNonce}`, {
      nonce: activeNonce,
      usedAt: asUnixMs(now),
      expiresAt: activeAt,
    });
    snapshot.set(createNonceIndexKey(expiredAt, expiredNonce), {
      nonce: expiredNonce,
      expiresAt: expiredAt,
    });
    snapshot.set(createNonceIndexKey(activeAt, activeNonce), {
      nonce: activeNonce,
      expiresAt: activeAt,
    });

    await vault.alarm(now);

    expect(snapshot.get(`${NONCE_KEY_PREFIX}${expiredNonce}`)).toBeUndefined();
    expect(snapshot.get(createNonceIndexKey(expiredAt, expiredNonce))).toBeUndefined();
    expect(snapshot.get(`${NONCE_KEY_PREFIX}${activeNonce}`)).toBeDefined();
    expect(snapshot.get(createNonceIndexKey(activeAt, activeNonce))).toBeDefined();
    expect(getAlarm()).toBe(Number(activeAt));
  });

  it('alarm clears expired nonce entries across multiple batches before rearming', async () => {
    const now = 1_730_001_452_000;
    const record = createChannelRecord(CHANNEL_STATE.LOCKED);
    const { state, snapshot, getAlarm } = createMockState(record);
    const vault = new SecretVault(state, env);
    const activeNonce = asBase64Url('nonce_active_tail');
    const activeAt = asUnixMs(now + 20_000);

    for (let index = 0; index < 140; index += 1) {
      const nonce = asBase64Url(`nonce_expired_${String(index).padStart(3, '0')}`);
      const expiresAt = asUnixMs(now - 5_000 - index);
      snapshot.set(`${NONCE_KEY_PREFIX}${nonce}`, {
        nonce,
        usedAt: asUnixMs(now - 10_000 - index),
        expiresAt,
      });
      snapshot.set(createNonceIndexKey(expiresAt, nonce), {
        nonce,
        expiresAt,
      });
    }

    snapshot.set(`${NONCE_KEY_PREFIX}${activeNonce}`, {
      nonce: activeNonce,
      usedAt: asUnixMs(now),
      expiresAt: activeAt,
    });
    snapshot.set(createNonceIndexKey(activeAt, activeNonce), {
      nonce: activeNonce,
      expiresAt: activeAt,
    });

    await vault.alarm(now);

    for (let index = 0; index < 140; index += 1) {
      const nonce = asBase64Url(`nonce_expired_${String(index).padStart(3, '0')}`);
      const expiresAt = asUnixMs(now - 5_000 - index);
      expect(snapshot.get(`${NONCE_KEY_PREFIX}${nonce}`)).toBeUndefined();
      expect(snapshot.get(createNonceIndexKey(expiresAt, nonce))).toBeUndefined();
    }

    expect(snapshot.get(`${NONCE_KEY_PREFIX}${activeNonce}`)).toBeDefined();
    expect(snapshot.get(createNonceIndexKey(activeAt, activeNonce))).toBeDefined();
    expect(getAlarm()).toBe(Number(activeAt));
  });

  it('alarm deletes malformed nonce indexes without scheduling a retry loop', async () => {
    const now = 1_730_001_453_000;
    const { state, snapshot, getAlarm } = createMockState();
    const vault = new SecretVault(state, env);

    snapshot.set(`${NONCE_INDEX_KEY_PREFIX}not-a-timestamp:nonce_invalid_01`, {
      nonce: asBase64Url('nonce_invalid_01'),
      expiresAt: Number.NaN,
    });

    await vault.alarm(now);

    expect([...snapshot.keys()]).toEqual([]);
    expect(getAlarm()).toBeNull();
  });

  it('lazy-purges expired record on public read and returns not found', async () => {
    const now = 1_730_001_455_000;
    const expiredRecord = {
      ...createChannelRecord(CHANNEL_STATE.LOCKED),
      expiresAt: asUnixMs(now - 1),
    };
    const { state, snapshot, getAlarm } = createMockState(expiredRecord);
    const vault = new SecretVault(state, env);

    const response = await vault.fetch(
      new Request('https://zerolink.test/get_public_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    const payload = (await response.json()) as { ok: false; code: string };
    const tombstone = readTerminalTombstone(snapshot);

    expect(response.status).toBe(404);
    expect(payload).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(snapshot.get(CHANNEL_RECORD_KEY)).toBeUndefined();
    expect([...snapshot.keys()]).toEqual([TERMINAL_TOMBSTONE_KEY]);
    expect(tombstone?.uuid).toBe(expiredRecord.uuid);
    expect(tombstone?.reason).toBe('expired');
    expect(Number(tombstone?.finalizedAt)).toBeGreaterThan(Number(expiredRecord.expiresAt));
    expect(getAlarm()).toBeNull();
  });

  it('alarm purges records with invalid expiresAt values and clears the alarm', async () => {
    const now = 1_730_001_455_500;
    const invalidRecord = {
      ...createChannelRecord(CHANNEL_STATE.LOCKED),
      expiresAt: Number.NaN as UnixMs,
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { state, snapshot, getAlarm } = createMockState(invalidRecord);
    const vault = new SecretVault(state, env);

    await vault.alarm(now);

    expect(snapshot.get(CHANNEL_RECORD_KEY)).toBeUndefined();
    expect(readTerminalTombstone(snapshot)).toEqual({
      uuid: invalidRecord.uuid,
      reason: 'expired',
      finalizedAt: asUnixMs(now),
    });
    expect(getAlarm()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('alarm purges expired record and delete follow-up fetches return 404', async () => {
    const now = 1_730_001_456_000;
    const expiredRecord = {
      ...createChannelRecord(CHANNEL_STATE.LOCKED),
      expiresAt: asUnixMs(now - 1),
    };
    const { state, snapshot, getAlarm } = createMockState(expiredRecord);
    const vault = new SecretVault(state, env);

    await vault.alarm(now);

    const tombstone = readTerminalTombstone(snapshot);
    expect(snapshot.get(CHANNEL_RECORD_KEY)).toBeUndefined();
    expect([...snapshot.keys()]).toEqual([TERMINAL_TOMBSTONE_KEY]);
    expect(tombstone).toEqual({
      uuid: expiredRecord.uuid,
      reason: 'expired',
      finalizedAt: asUnixMs(now),
    });
    expect(getAlarm()).toBeNull();

    const publicResponse = await vault.fetch(
      new Request('https://zerolink.test/get_public_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    const publicPayload = (await publicResponse.json()) as { ok: false; code: string };
    expect(publicResponse.status).toBe(404);
    expect(publicPayload).toEqual({ ok: false, code: 'NOT_FOUND' });

    const decryptResponse = await vault.fetch(
      new Request('https://zerolink.test/get_decrypt_payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    const decryptPayload = (await decryptResponse.json()) as { ok: false; code: string };
    expect(decryptResponse.status).toBe(404);
    expect(decryptPayload).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('rejects compound commit with timestamp out of allowed skew', async () => {
    const now = 1_730_001_500_000;
    const record = createChannelRecord(CHANNEL_STATE.LOCKED);
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);
    const intent = createUpdateIntent(
      record.uuid,
      record.version,
      asUnixMs(now + TIMESTAMP_SKEW_MS + 1),
      asBase64Url('nonce_time_01'),
      asHex('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    );
    const intentHash = await computeIntentHash(toRecord(intent));

    await expect(
      vault.commitCompound(
        {
          uuid: record.uuid,
          assertion: createAssertionFixture(
            (record.adminCredential as StoredCredential).credentialId
          ),
          intentHash,
          intent,
        },
        now
      )
    ).rejects.toMatchObject({ code: 'TIMESTAMP_OUT_OF_RANGE' });
  });

  it('rejects compound commit when intent hash mismatches', async () => {
    const now = 1_730_001_600_000;
    const record = createChannelRecord(CHANNEL_STATE.LOCKED);
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);
    const intent = createUpdateIntent(
      record.uuid,
      record.version,
      asUnixMs(now),
      asBase64Url('nonce_hash_01'),
      asHex('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    );

    await expect(
      vault.commitCompound(
        {
          uuid: record.uuid,
          assertion: createAssertionFixture(
            (record.adminCredential as StoredCredential).credentialId
          ),
          intentHash: asHex('00'),
          intent,
        },
        now
      )
    ).rejects.toMatchObject({ code: 'INTENT_HASH_MISMATCH' });
  });

  it('rejects compound commit when challenge is missing', async () => {
    const now = 1_730_001_700_000;
    const record = createChannelRecord(CHANNEL_STATE.LOCKED);
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);
    const intent = createUpdateIntent(
      record.uuid,
      record.version,
      asUnixMs(now),
      asBase64Url('nonce_missing_01'),
      asHex('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    );
    const intentHash = await computeIntentHash(toRecord(intent));

    await expect(
      vault.commitCompound(
        {
          uuid: record.uuid,
          assertion: createAssertionFixture(
            (record.adminCredential as StoredCredential).credentialId
          ),
          intentHash,
          intent,
        },
        now
      )
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
  });

  it('rejects compound commit when assertion is invalid', async () => {
    const now = 1_730_001_800_000;
    const record = createChannelRecord(CHANNEL_STATE.LOCKED);
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);
    const begin = await vault.beginCompoundChallenge(record.uuid, now);
    const intent = createUpdateIntent(
      record.uuid,
      record.version,
      asUnixMs(now + 1_000),
      asBase64Url('nonce_assert_01'),
      asHex('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    );
    const intentHash = await computeIntentHash(toRecord(intent));
    const wrongChallenge = await computeCompoundChallengeValue(
      record.uuid,
      begin.challenge.id,
      intentHash,
      begin.challenge.seed
    );
    const assertionFixture = await createMockAssertion({
      credentialId: (record.adminCredential as StoredCredential).credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: wrongChallenge,
      signCount: 5,
    });

    await expect(
      vault.commitCompound(
        {
          uuid: record.uuid,
          assertion: createAssertionFixture(assertionFixture.assertion.id),
          intentHash,
          intent,
        },
        now + 1_000
      )
    ).rejects.toMatchObject({ code: 'ASSERTION_INVALID' });
  });

  it('commits update intent with softkey signature for softkey admin channel', async () => {
    const now = 1_730_001_900_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING, 'softkey')
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + 1_000),
      asBase64Url('nonce_softkey_01'),
      lockParams.receiverPubFpr
    );
    const intentHash = await computeIntentHash(toRecord(intent));

    const verifySoftkeySignatureMock = vi.mocked(softkeyCrypto.verifySoftkeySignature);
    verifySoftkeySignatureMock.mockResolvedValueOnce({
      ok: true,
      data: undefined,
    });

    await vault.commitCompound(
      {
        adminMode: 'softkey',
        uuid: lockedRecord.uuid,
        softkeySignature: asHex(
          'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef'
        ),
        intentHash,
        intent,
      },
      now + 1_000
    );

    const updated = await vault.getRecord();
    expect(updated.state).toBe(CHANNEL_STATE.DELIVERED);
    expect(updated.version).toBe(lockedRecord.version + 1);
    expect(updated.adminMode).toBe('softkey');
    expect(verifySoftkeySignatureMock).toHaveBeenCalledTimes(1);

    verifySoftkeySignatureMock.mockReset();
  });
});

describe('SecretVault create flow', () => {
  it('begins creation and initializes a record with WAITING state', async () => {
    const { state, snapshot } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');

    const options = (await vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY)) as {
      challenge: unknown;
      user: { id: unknown };
      attestation: unknown;
    };
    const record = snapshot.get(CHANNEL_RECORD_KEY) as ChannelRecord;

    expect(record.uuid).toBe(uuid);
    expect(record.state).toBe(CHANNEL_STATE.WAITING);
    expect(record.securityProfile).toBe(SECURITY_PROFILE.HARDWARE_ONLY);
    expect(options.challenge).toBeDefined();
    expect(options.user.id).toBeDefined();
    // attestation is always 'none' now; hardware_only no longer enforces direct attestation
    expect(options.attestation).toBe('none');
  });

  it('rejects beginCreate when a terminal tombstone already occupies the uuid', async () => {
    const uuid = asUuid('new-channel-uuid-12345');
    const { state, snapshot } = createMockState();
    snapshot.set(TERMINAL_TOMBSTONE_KEY, {
      uuid,
      reason: 'deleted',
      finalizedAt: asUnixMs(1_730_000_000_000),
    } satisfies StoredTerminalTombstone);
    const vault = new SecretVault(state, env);

    await expect(vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    expect(readTerminalTombstone(snapshot)).toEqual({
      uuid,
      reason: 'deleted',
      finalizedAt: asUnixMs(1_730_000_000_000),
    });
    expect(snapshot.get(CHANNEL_RECORD_KEY)).toBeUndefined();
  });

  it('converts expired residual records into tombstones and rejects beginCreate reuse', async () => {
    const now = 1_730_000_999_000;
    const uuid = asUuid('new-channel-uuid-12345');
    const expiredRecord: ChannelRecord = {
      ...createChannelRecord(CHANNEL_STATE.LOCKED),
      uuid,
      expiresAt: asUnixMs(now - 1),
      receiver: {
        pubJwk: createReceiverJwk(),
        pubFpr: asHex('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'),
        lockedAt: asUnixMs(now - 10_000),
      },
      cipherBundle: createCipherBundle(),
      deliveredAt: asUnixMs(now - 5_000),
    };
    const { state, snapshot, getAlarm } = createMockState(expiredRecord);
    const vault = new SecretVault(state, env);

    await expect(
      vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY, now)
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });

    expect(snapshot.get(CHANNEL_RECORD_KEY)).toBeUndefined();
    expect(snapshot.get(CREATION_CHALLENGE_KEY)).toBeUndefined();
    expect(readTerminalTombstone(snapshot)).toEqual({
      uuid,
      reason: 'expired',
      finalizedAt: asUnixMs(now),
    });
    expect([...snapshot.keys()]).toEqual([TERMINAL_TOMBSTONE_KEY]);
    expect(getAlarm()).toBeNull();
  });

  it('commits creation successfully for HARDWARE_ONLY with valid attestation', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: true,
      fmt: 'packed',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    const lockKeyB64u = asBase64Url('lock-key');
    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u,
    });

    const updated = await vault.getRecord();
    expect(updated.adminMode).toBe('webauthn');
    expect(updated.lockKey).toBe(lockKeyB64u);
    expect((updated.adminCredential as StoredCredential).credentialId).toBe('cred-id');
  });

  it('rejects creation for HARDWARE_ONLY with unverified attestation', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: false,
      fmt: 'none',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
      warning: 'none attestation is considered unverified',
    });

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'webauthn',
        attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toThrow('requires verified attestation');
  });

  it('allows creation for HARDWARE_ONLY with all-zero AAGUID (enforcement removed)', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: true,
      fmt: 'packed',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: encodeBase64Url(new Uint8Array(16)), // all-zero AAGUID — no longer rejected
      signCount: 0,
    });

    // hardware_only no longer rejects all-zero AAGUID — creation should succeed
    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u: asBase64Url('lock-key'),
    });
    const updated = await vault.getRecord();
    expect(updated.adminMode).toBe('webauthn');
  });

  it('rejects creation for STRICT with unverified attestation', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.STRICT);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: false,
      fmt: 'none',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'webauthn',
        attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toThrow('requires verified attestation');
  });

  it('rejects password adminMode for secure profile (H-1 downgrade prevention)', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'password',
        softkeyPubJwk: {
          kty: 'EC',
          crv: 'P-256',
          x: asBase64Url('x'),
          y: asBase64Url('y'),
        } as never,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toThrow("security profile 'secure' requires webauthn admin mode");
  });

  it('rejects softkey adminMode for hardware_only profile (H-1 downgrade prevention)', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY);

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'softkey',
        softkeyPubJwk: {
          kty: 'EC',
          crv: 'P-256',
          x: asBase64Url('x'),
          y: asBase64Url('y'),
        } as never,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toThrow("security profile 'hardware_only' requires webauthn admin mode");
  });

  it('allows password adminMode for standard profile', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.STANDARD);

    await vault.commitCreate({
      uuid,
      adminMode: 'password',
      softkeyPubJwk: { kty: 'EC', crv: 'P-256', x: asBase64Url('x'), y: asBase64Url('y') } as never,
      lockKeyB64u: asBase64Url('lock-key'),
    });
    const updated = await vault.getRecord();
    expect(updated.adminMode).toBe('password');
  });

  it('beginCreate stores creation challenge under CREATION_CHALLENGE_KEY', async () => {
    const { state, snapshot } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');

    await vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY);

    const storedChallenge = snapshot.get(CREATION_CHALLENGE_KEY) as string;
    expect(storedChallenge).toBeDefined();
    expect(decodeBase64Url(storedChallenge).byteLength).toBe(32);
  });

  it('commitCreate passes expectedChallenge to verifyAttestation and deletes the key', async () => {
    const { state, snapshot } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY);

    const storedChallengeB64u = snapshot.get(CREATION_CHALLENGE_KEY) as string;
    expect(storedChallengeB64u).toBeDefined();
    const expectedChallenge = decodeBase64Url(storedChallengeB64u);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: true,
      fmt: 'packed',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u: asBase64Url('lock-key'),
    });

    expect(verifyAttestationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge,
        expectedRpId: RP_ID,
        expectedOrigin: RP_ORIGIN,
      })
    );
    // Challenge must be deleted after use (one-time)
    expect(snapshot.get(CREATION_CHALLENGE_KEY)).toBeUndefined();
  });

  it('commitCreate throws CHALLENGE_INVALID when no creation challenge exists', async () => {
    const { state, snapshot } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY);

    // Simulate missing challenge (e.g. already consumed or never set)
    snapshot.delete(CREATION_CHALLENGE_KEY);

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'webauthn',
        attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
  });

  it('commitCreate maps verifyAttestation throw to ATTESTATION_UNVERIFIABLE', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.STRICT);

    vi.mocked(verifyAttestation).mockRejectedValueOnce(
      new Error('x5c attestation (certificate chain) is not yet supported')
    );

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'webauthn',
        attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toMatchObject({ code: 'ATTESTATION_UNVERIFIABLE' });
  });

  it('create_finish response uses RP_ORIGIN for shareUrl/manageUrl (not internal DO hostname)', async () => {
    // UUID must be exactly 21 chars (NanoID format required by schema)
    const uuid = 'abcdefghijklmnopqrstu';
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    await vault.beginCreate(asUuid(uuid), SECURITY_PROFILE.STANDARD);

    // Softkey mode: no attestation needed, simpler setup
    const payload = {
      adminMode: 'softkey',
      uuid,
      softkeyPubJwk: {
        kty: 'EC',
        crv: 'P-256',
        x: 'aBcDeFgHiJkLmNoPqRsTuVw',
        y: 'bBcDeFgHiJkLmNoPqRsTuVw',
        ext: true,
        key_ops: ['verify'],
      },
      lockKeyB64u: 'bG9ja2tleQ',
      timestamp: 1730000100000,
    };

    // Request arrives at an internal DO hostname, not the public RP_ORIGIN
    const response = await vault.fetch(
      new Request('https://fake-internal.workers.dev/create_finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      shareUrl?: string;
      manageUrl?: string;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    // Must use RP_ORIGIN, not the internal DO hostname
    expect(body.shareUrl).toBe(`${RP_ORIGIN}/s/${uuid}`);
    expect(body.manageUrl).toBe(`${RP_ORIGIN}/m/${uuid}`);
    expect(body.shareUrl).not.toContain('fake-internal');
    expect(body.manageUrl).not.toContain('fake-internal');
  });

  it('commitCreate passes requireUserVerification:true for STRICT profile', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.STRICT);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: true,
      fmt: 'packed',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u: asBase64Url('lock-key'),
    });

    expect(verifyAttestationMock).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: true })
    );
  });

  it('commitCreate passes requireUserVerification:true for HARDWARE_ONLY profile', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.HARDWARE_ONLY);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: true,
      fmt: 'packed',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u: asBase64Url('lock-key'),
    });

    expect(verifyAttestationMock).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: true })
    );
  });

  it('commitCreate passes requireUserVerification:false for STANDARD profile', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.STANDARD);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: false,
      fmt: 'none',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u: asBase64Url('lock-key'),
    });

    expect(verifyAttestationMock).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: false })
    );
  });
});
