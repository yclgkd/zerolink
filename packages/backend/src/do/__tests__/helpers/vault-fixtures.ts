import type {
  AssertionJSON,
  Base64Url,
  ChannelRecord,
  ChannelState,
  CipherBundle,
  DeleteIntent,
  HexString,
  LockChallenge,
  RSAPublicKeyJWK,
  UnixMs,
  UpdateIntent,
  UUID,
} from '@zerolink/shared';
import {
  buildCipherBundleAadBytes,
  CHANNEL_STATE,
  CHANNEL_TTL_MS,
  DOMAIN,
  SECURITY_PROFILE,
} from '@zerolink/shared';
import { expect } from 'vitest';
import { createMockR2Bucket } from '../../../__tests__/helpers/r2-fixtures.ts';
import { createCommitToken } from '../../../commitTokens.ts';
import {
  CHANNEL_RECORD_KEY,
  type CommitLockParams,
  NONCE_INDEX_KEY_PREFIX,
  type SecretVaultEnv,
  StateTransitionError,
  type StoredCompoundChallenge,
  type StoredLockChallenge,
  type StoredTerminalTombstone,
  TERMINAL_TOMBSTONE_KEY,
} from '../../SecretVault.ts';

// ---------------------------------------------------------------------------
// Type-cast helpers
// ---------------------------------------------------------------------------

export function asUuid(value: string): UUID {
  return value as UUID;
}

export function asBase64Url(value: string): Base64Url {
  return value as Base64Url;
}

export function asHex(value: string): HexString {
  return value as HexString;
}

export function asUnixMs(value: number): UnixMs {
  return value as UnixMs;
}

// ---------------------------------------------------------------------------
// Binary / encoding utilities
// ---------------------------------------------------------------------------

export function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
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

export function encodeBase64Url(bytes: Uint8Array): Base64Url {
  return btoa(bytesToBinary(bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '') as Base64Url;
}

export function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return binaryToBytes(atob(padded));
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

export async function sha256Hex(chunks: readonly Uint8Array[]): Promise<HexString> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBufferBytes(concatBytes(chunks)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  ) as HexString;
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }

  return bytes;
}

// ---------------------------------------------------------------------------
// Legacy key helpers (kept for backwards-compat tests)
// ---------------------------------------------------------------------------

const LEGACY_LOCK_CHALLENGE_KEY_PREFIX = 'lock_challenge:' as const;

export function legacyLockChallengeStorageKey(id: Base64Url): string {
  return `${LEGACY_LOCK_CHALLENGE_KEY_PREFIX}${id}`;
}

// ---------------------------------------------------------------------------
// RSA receiver key — populated by setupRealReceiverKey()
// ---------------------------------------------------------------------------

// Must be populated by calling setupRealReceiverKey() in beforeAll before use.
export let realReceiverJwk: RSAPublicKeyJWK;
export let realReceiverPubFpr: HexString;

export const FIXTURE_CIPHERTEXT = asBase64Url('ciphertext');
export const FIXTURE_CIPHERTEXT_HASH = asHex(
  '897dab5b0127d49c794f0f3f39cbb6aefb2ef22184ee0540a8c9f46909b9c90d'
);

/**
 * Generates a real RSA-OAEP-2048 key pair and sets the module-level
 * `realReceiverJwk` / `realReceiverPubFpr` variables.  Call this from a
 * `beforeAll` in each test file that needs cipher-bundle fixtures.
 */
export async function setupRealReceiverKey(): Promise<void> {
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
}

// ---------------------------------------------------------------------------
// Lock key
// ---------------------------------------------------------------------------

export function createLockKey(): Base64Url {
  return encodeBase64Url(Uint8Array.from([1, 35, 69, 103, 137, 171, 205, 239]));
}

// ---------------------------------------------------------------------------
// Receiver JWK accessor (uses module-level variable set by setupRealReceiverKey)
// ---------------------------------------------------------------------------

export function createReceiverJwk(): RSAPublicKeyJWK {
  return realReceiverJwk;
}

// ---------------------------------------------------------------------------
// CipherBundle factory
// ---------------------------------------------------------------------------

export function createCipherBundle(
  uuid: UUID = asUuid('abcdefghijklmnopqrstu'),
  version: number = 0,
  receiverPubFpr: HexString = realReceiverPubFpr,
  overrides: Partial<CipherBundle> = {}
): CipherBundle {
  return {
    ciphertext: FIXTURE_CIPHERTEXT,
    iv: asBase64Url('iv1234567890'),
    aad: encodeBase64Url(
      buildCipherBundleAadBytes({
        uuid,
        version,
        receiverPubFpr,
      })
    ),
    encContentKey: asBase64Url('enc-content-key'),
    ciphertextHash: FIXTURE_CIPHERTEXT_HASH,
    padBlock: 4096,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CommitLock / CommitDelivery param factories
// ---------------------------------------------------------------------------

export function createCommitLockParams(): CommitLockParams {
  return {
    receiverPubJwk: createReceiverJwk(),
    receiverPubFpr: realReceiverPubFpr,
    lockedAt: asUnixMs(1_730_000_200_000),
  };
}

export function createCommitDeliveryParams() {
  return {
    cipherBundle: createCipherBundle(),
    deliveredAt: asUnixMs(1_730_000_300_000),
  };
}

// ---------------------------------------------------------------------------
// Intent factories
// ---------------------------------------------------------------------------

export function createUpdateIntent(
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
    cipherBundle: createCipherBundle(uuid, version, receiverPubFpr),
    expireAt: null,
  };
}

export function createDeleteIntent(
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

// ---------------------------------------------------------------------------
// ChannelRecord factory
// ---------------------------------------------------------------------------

export const FIXTURE_CREATED_AT = asUnixMs(1_900_000_000_000);
export const FIXTURE_EXPIRES_AT = asUnixMs(1_900_000_000_000 + CHANNEL_TTL_MS.ONE_DAY);

export function createChannelRecord(
  state: ChannelState = CHANNEL_STATE.WAITING,
  adminMode: 'webauthn' | 'softkey' = 'webauthn'
): ChannelRecord {
  return {
    uuid: asUuid('abcdefghijklmnopqrstu'),
    state,
    createdAt: FIXTURE_CREATED_AT,
    expiresAt: FIXTURE_EXPIRES_AT,
    ttl: CHANNEL_TTL_MS.ONE_DAY,
    securityProfile: adminMode === 'softkey' ? SECURITY_PROFILE.QUICK : SECURITY_PROFILE.SECURE,
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

// ---------------------------------------------------------------------------
// DurableObject state mock
// ---------------------------------------------------------------------------

export function createMockState(initialRecord?: ChannelRecord): {
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

// ---------------------------------------------------------------------------
// Environment mock
// ---------------------------------------------------------------------------

export const RP_ID = 'zerolink.test';
export const RP_ORIGIN = 'https://zerolink.test';
export const CALLER_KEY_A = asBase64Url('caller_key_a');
export const CALLER_KEY_B = asBase64Url('caller_key_b');

export const env: SecretVaultEnv = {
  SECRET_VAULT: {} as DurableObjectNamespace,
  APP_ENV: 'test',
  COMMIT_TOKEN_SECRET: 'commit-token-secret',
  RP_ID,
  RP_ORIGIN,
  FILE_BUCKET: createMockR2Bucket(),
};

// ---------------------------------------------------------------------------
// Commit token helper
// ---------------------------------------------------------------------------

export async function createBoundCommitToken(
  kind: 'lock' | 'compound',
  uuid: UUID,
  challenge: Pick<StoredLockChallenge | StoredCompoundChallenge, 'id' | 'issuedAt' | 'expiresAt'>,
  callerKey: Base64Url
): Promise<string> {
  if (challenge.issuedAt === undefined) {
    throw new Error('challenge.issuedAt is required');
  }

  return createCommitToken(env.COMMIT_TOKEN_SECRET, {
    kind,
    uuid,
    challengeId: challenge.id,
    callerKey,
    iat: challenge.issuedAt,
    exp: challenge.expiresAt,
  });
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export function expectStateTransitionError(
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

export async function computeLockProof(
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

export function createAssertionFixture(credentialId: Base64Url): AssertionJSON {
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

export function createNonceIndexKey(expiresAt: UnixMs, nonce: Base64Url): string {
  return `${NONCE_INDEX_KEY_PREFIX}${String(expiresAt).padStart(16, '0')}:${nonce}`;
}

export function readTerminalTombstone(
  snapshot: Map<string, unknown>
): StoredTerminalTombstone | undefined {
  return snapshot.get(TERMINAL_TOMBSTONE_KEY) as StoredTerminalTombstone | undefined;
}

export async function computeCompoundChallengeValue(
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

export function toRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
