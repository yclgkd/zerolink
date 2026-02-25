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
  CHALLENGE_TTL_MS,
  CHANNEL_STATE,
  CHANNEL_TTL_MS,
  computeIntentHash,
  DOMAIN,
  NONCE_TTL_MS,
  SECURITY_PROFILE,
  TIMESTAMP_SKEW_MS,
} from '@zerolink/shared';
import { describe, expect, it } from 'vitest';

import { createMockAssertion } from '../../__tests__/helpers/webauthn-fixtures.ts';
import {
  CHANNEL_RECORD_KEY,
  COMPOUND_CHALLENGE_KEY,
  type CommitDeliveryParams,
  type CommitLockChallengeParams,
  type CommitLockParams,
  LOCK_CHALLENGE_KEY_PREFIX,
  NONCE_KEY_PREFIX,
  SecretVault,
  type SecretVaultEnv,
  SecretVaultStateMachine,
  StateTransitionError,
} from '../SecretVault.ts';

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

function createReceiverJwk(): RSAPublicKeyJWK {
  return {
    kty: 'RSA',
    alg: 'RSA-OAEP-256',
    n: asBase64Url('n-modulus-value'),
    e: asBase64Url('AQAB'),
    ext: true,
    key_ops: ['encrypt'],
  };
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
    receiverPubFpr: asHex('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'),
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

function createChannelRecord(state: ChannelState = CHANNEL_STATE.WAITING): ChannelRecord {
  return {
    uuid: asUuid('abcdefghijklmnopqrstu'),
    state,
    createdAt: asUnixMs(1_730_000_000_000),
    expiresAt: asUnixMs(1_730_086_400_000),
    ttl: CHANNEL_TTL_MS.ONE_DAY,
    securityProfile: SECURITY_PROFILE.STANDARD,
    adminMode: 'webauthn',
    adminCredential: {
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
} {
  const snapshot = new Map<string, unknown>();
  if (initialRecord) {
    snapshot.set(CHANNEL_RECORD_KEY, structuredClone(initialRecord));
  }

  const storage = {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return snapshot.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T): Promise<void> {
      snapshot.set(key, structuredClone(value));
    },
    async delete(key: string): Promise<boolean> {
      return snapshot.delete(key);
    },
  } as unknown as DurableObjectStorage;

  const state = {
    waitUntil(_promise: Promise<unknown>): void {},
    props: {},
    id: {} as DurableObjectId,
    storage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => callback(),
  } as unknown as DurableObjectState;

  return { state, snapshot };
}

const RP_ID = 'zerolink.test';
const RP_ORIGIN = 'https://zerolink.test';

const env: SecretVaultEnv = {
  SECRET_VAULT: {} as DurableObjectNamespace,
  SECRETS_KV: {} as KVNamespace,
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
    const storedChallenge = snapshot.get(
      `${LOCK_CHALLENGE_KEY_PREFIX}${challenge.id}`
    ) as LockChallenge;

    expect(challenge.expiresAt).toBe(asUnixMs(now + CHALLENGE_TTL_MS));
    expect(storedChallenge.id).toBe(challenge.id);
    expect(decodeBase64Url(challenge.challenge).byteLength).toBe(32);
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
    const storedChallenge = snapshot.get(`${LOCK_CHALLENGE_KEY_PREFIX}${challenge.id}`) as {
      consumedAt?: UnixMs;
    };
    expect(updated.state).toBe(CHANNEL_STATE.LOCKED);
    expect(updated.receiver?.pubFpr).toBe(lockParams.receiverPubFpr);
    expect(storedChallenge.consumedAt).toBeDefined();
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
    expect(snapshot.get(`${LOCK_CHALLENGE_KEY_PREFIX}${challenge.id}`)).toBeUndefined();
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

    const challengeKey = `${LOCK_CHALLENGE_KEY_PREFIX}${challenge.id}`;
    const storedChallenge = snapshot.get(challengeKey) as {
      id: Base64Url;
      challenge: Base64Url;
      expiresAt: UnixMs;
    };
    snapshot.set(challengeKey, {
      ...storedChallenge,
      consumedAt: asUnixMs(now + 500),
    });

    await expect(vault.commitLockChallenge(params, now + 1_000)).rejects.toMatchObject({
      code: 'CHALLENGE_CONSUMED',
    });
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
  it('issues and stores compound challenge with current version and receiver info', async () => {
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
    expect(result.receiverPubFpr).toBe(lockParams.receiverPubFpr);
    expect(result.receiverPubJwk).toEqual(lockParams.receiverPubJwk);
    expect(result.challenge.id).toBe(storedChallenge.id);
    expect(result.challenge.seed).toBe(storedChallenge.seed);
    expect(result.challenge.expiresAt).toBe(asUnixMs(now + CHALLENGE_TTL_MS));
  });

  it('commits update intent and transitions locked to delivered', async () => {
    const now = 1_730_001_100_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
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
      credentialId: lockedRecord.adminCredential.credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: expectedChallenge,
      signCount: 7,
    });

    snapshot.set(CHANNEL_RECORD_KEY, {
      ...lockedRecord,
      adminCredential: {
        ...lockedRecord.adminCredential,
        publicKey: assertionFixture.publicKeySpki,
        signCount: 3,
      },
    });

    await vault.commitCompound(
      {
        uuid: lockedRecord.uuid,
        assertion: assertionFixture.assertion,
        intentHash,
        intent,
      },
      now + 1_000
    );

    const updated = await vault.getRecord();
    const nonceRecord = snapshot.get(`${NONCE_KEY_PREFIX}${intent.nonce}`) as {
      usedAt: UnixMs;
      expiresAt: UnixMs;
    };
    const consumedChallenge = snapshot.get(COMPOUND_CHALLENGE_KEY) as {
      consumedAt?: UnixMs;
    };

    expect(updated.state).toBe(CHANNEL_STATE.DELIVERED);
    expect(updated.version).toBe(lockedRecord.version + 1);
    expect(updated.cipherBundle).toEqual(intent.cipherBundle);
    expect(updated.deliveredAt).toBe(intent.timestamp);
    expect(updated.adminCredential.signCount).toBe(7);
    expect(nonceRecord.expiresAt).toBe(asUnixMs(now + 1_000 + NONCE_TTL_MS));
    expect(consumedChallenge.consumedAt).toBeDefined();
  });

  it('commits delete intent and transitions to deleted', async () => {
    const now = 1_730_001_200_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const { state, snapshot } = createMockState(record);
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
      credentialId: record.adminCredential.credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: expectedChallenge,
      signCount: 9,
    });

    snapshot.set(CHANNEL_RECORD_KEY, {
      ...record,
      adminCredential: {
        ...record.adminCredential,
        publicKey: assertionFixture.publicKeySpki,
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

    const updated = await vault.getRecord();
    expect(updated.state).toBe(CHANNEL_STATE.DELETED);
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
          assertion: createAssertionFixture(record.adminCredential.credentialId),
          intentHash,
          intent,
        },
        now
      )
    ).rejects.toMatchObject({ code: 'VERSION_MISMATCH' });
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
          assertion: createAssertionFixture(record.adminCredential.credentialId),
          intentHash,
          intent,
        },
        now
      )
    ).rejects.toMatchObject({ code: 'NONCE_REPLAY' });
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
          assertion: createAssertionFixture(record.adminCredential.credentialId),
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
          assertion: createAssertionFixture(record.adminCredential.credentialId),
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
          assertion: createAssertionFixture(record.adminCredential.credentialId),
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
      credentialId: record.adminCredential.credentialId,
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
});
