import type {
  Base64Url,
  ChannelRecord,
  ChannelState,
  CipherBundle,
  HexString,
  RSAPublicKeyJWK,
  UnixMs,
  UUID,
} from '@zerolink/shared';
import { CHANNEL_STATE, CHANNEL_TTL_MS, SECURITY_PROFILE } from '@zerolink/shared';
import { describe, expect, it } from 'vitest';

import {
  CHANNEL_RECORD_KEY,
  type CommitDeliveryParams,
  type CommitLockParams,
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
    lockKey: asBase64Url('lock-key'),
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

const env: SecretVaultEnv = {
  SECRET_VAULT: {} as DurableObjectNamespace,
  SECRETS_KV: {} as KVNamespace,
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

describe('SecretVault durable object wrapper', () => {
  it('initializes and reads the stored channel record', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const record = createChannelRecord(CHANNEL_STATE.WAITING);

    await vault.initialize(record);
    const loaded = await vault.getRecord();

    expect(loaded).toEqual(record);
  });

  it('persists waiting -> locked -> delivered -> deleted transition chain', async () => {
    const { state, snapshot } = createMockState(createChannelRecord(CHANNEL_STATE.WAITING));
    const vault = new SecretVault(state, env);

    const locked = await vault.commitLock(createCommitLockParams());
    expect(locked.state).toBe(CHANNEL_STATE.LOCKED);

    const delivered = await vault.commitDelivery(createCommitDeliveryParams());
    expect(delivered.state).toBe(CHANNEL_STATE.DELIVERED);
    expect(delivered.version).toBe(1);

    const deleted = await vault.commitDelete();
    expect(deleted.state).toBe(CHANNEL_STATE.DELETED);

    const stored = snapshot.get(CHANNEL_RECORD_KEY) as ChannelRecord;
    expect(stored.state).toBe(CHANNEL_STATE.DELETED);
    expect(stored.version).toBe(1);
  });

  it('throws RECORD_NOT_FOUND when transitioning before initialization', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);

    await expect(vault.commitDelete()).rejects.toMatchObject({
      code: 'RECORD_NOT_FOUND',
    });
  });

  it('returns 501 from fetch while api-level wiring is not implemented', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);

    const response = await vault.fetch(new Request('https://zerolink.test/do/secret-vault'));
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(501);
    expect(payload).toEqual({
      ok: false,
      code: 'NOT_IMPLEMENTED',
    });
  });
});
