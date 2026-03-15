import type {
  AttestationJSON,
  Base64Url,
  ChannelRecord,
  CipherBundle,
  DeleteIntent,
  HexString,
  LockChallenge,
  StoredCredential,
  UnixMs,
  UpdateIntent,
  UUID,
} from '@zerolink/shared';
import {
  CHALLENGE_TTL_MS,
  CHANNEL_STATE,
  computeIntentHash,
  deriveUpdateProofChallengeB64u,
  NONCE_TTL_MS,
  SECURITY_PROFILE,
  TIMESTAMP_SKEW_MS,
} from '@zerolink/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createMockAssertion } from '../../__tests__/helpers/webauthn-fixtures.ts';
import {
  createCommitToken,
  INTERNAL_CALLER_KEY_HEADER,
  INTERNAL_COMMIT_COOKIE_ACTION_HEADER,
  INTERNAL_COMMIT_COOKIE_EXP_HEADER,
  INTERNAL_COMMIT_COOKIE_KIND_HEADER,
  INTERNAL_COMMIT_COOKIE_TOKEN_HEADER,
} from '../../commitTokens.ts';
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
import {
  asBase64Url,
  asHex,
  asUnixMs,
  asUuid,
  CALLER_KEY_A,
  CALLER_KEY_B,
  computeCompoundChallengeValue,
  computeLockProof,
  createAssertionFixture,
  createBoundCommitToken,
  createChannelRecord,
  createCipherBundle,
  createCommitDeliveryParams,
  createCommitLockParams,
  createDeleteIntent,
  createMockState,
  createNonceIndexKey,
  createReceiverJwk,
  createUpdateIntent,
  decodeBase64Url,
  encodeBase64Url,
  env,
  expectStateTransitionError,
  hexToBytes,
  legacyLockChallengeStorageKey,
  RP_ID,
  RP_ORIGIN,
  readTerminalTombstone,
  setupRealReceiverKey,
  sha256Hex,
  toRecord,
  toUtf8Bytes,
} from './helpers/vault-fixtures.ts';

vi.mock('../../crypto/softkey.ts', () => ({
  verifySoftkeySignature: vi.fn(),
}));

vi.mock('../../crypto/attestation.ts', () => ({
  verifyAttestation: vi.fn(),
}));

beforeAll(async () => {
  await setupRealReceiverKey();
});

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

  it('returns the same internal lock commit token for the same caller and active challenge', async () => {
    const now = 1_730_000_100_000;
    const dateNowMock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);

    const firstResponse = await vault.fetch(
      new Request('https://zerolink.test/lock_begin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_CALLER_KEY_HEADER]: CALLER_KEY_A,
        },
        body: JSON.stringify({ uuid: record.uuid }),
      })
    );
    const secondResponse = await vault.fetch(
      new Request('https://zerolink.test/lock_begin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_CALLER_KEY_HEADER]: CALLER_KEY_A,
        },
        body: JSON.stringify({ uuid: record.uuid }),
      })
    );

    expect(firstResponse.headers.get(INTERNAL_COMMIT_COOKIE_ACTION_HEADER)).toBe('set');
    expect(firstResponse.headers.get(INTERNAL_COMMIT_COOKIE_KIND_HEADER)).toBe('lock');
    expect(firstResponse.headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER)).toBe(
      secondResponse.headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER)
    );
    expect(firstResponse.headers.get(INTERNAL_COMMIT_COOKIE_EXP_HEADER)).toBe(
      secondResponse.headers.get(INTERNAL_COMMIT_COOKIE_EXP_HEADER)
    );

    dateNowMock.mockRestore();
  });

  it('returns different internal lock commit tokens for different callers on the same active challenge', async () => {
    const now = 1_730_000_100_000;
    const dateNowMock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const { state } = createMockState(record);
    const vault = new SecretVault(state, env);

    const callerAResponse = await vault.fetch(
      new Request('https://zerolink.test/lock_begin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_CALLER_KEY_HEADER]: CALLER_KEY_A,
        },
        body: JSON.stringify({ uuid: record.uuid }),
      })
    );
    const callerBResponse = await vault.fetch(
      new Request('https://zerolink.test/lock_begin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_CALLER_KEY_HEADER]: CALLER_KEY_B,
        },
        body: JSON.stringify({ uuid: record.uuid }),
      })
    );

    expect(callerAResponse.headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER)).toBeTruthy();
    expect(callerAResponse.headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER)).not.toBe(
      callerBResponse.headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER)
    );

    dateNowMock.mockRestore();
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

  it('rejects a new-style lock token whose exp exceeds challenge expiry', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now, { callerKey: CALLER_KEY_A });
    const storedChallenge = snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge;
    const lockProof = await computeLockProof(record.uuid, challenge, record.lockKey);
    const invalidToken = await createCommitToken(env.COMMIT_TOKEN_SECRET, {
      kind: 'lock',
      uuid: record.uuid,
      challengeId: storedChallenge.id,
      callerKey: CALLER_KEY_A,
      iat: storedChallenge.issuedAt as UnixMs,
      exp: asUnixMs(storedChallenge.expiresAt + 1),
    });

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
        now + 1_000,
        {
          callerKey: CALLER_KEY_A,
          commitToken: invalidToken,
        }
      )
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
  });

  it('does not spend new-style lock_commit quota before token validation passes', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now, { callerKey: CALLER_KEY_A });
    const storedChallenge = snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge;
    const validToken = await createBoundCommitToken(
      'lock',
      record.uuid,
      storedChallenge,
      CALLER_KEY_A
    );
    const bruteForceParams: CommitLockChallengeParams = {
      uuid: record.uuid,
      lockChallengeId: challenge.id,
      lockProof: asHex('00'),
      receiverPubJwk: lockParams.receiverPubJwk,
      receiverPubFpr: lockParams.receiverPubFpr,
      lockedAt: lockParams.lockedAt,
    };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(
        vault.commitLockChallenge(bruteForceParams, now + 1_000 + attempt, {
          callerKey: CALLER_KEY_A,
          commitToken: undefined,
        })
      ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        vault.commitLockChallenge(bruteForceParams, now + 10_000 + attempt, {
          callerKey: CALLER_KEY_A,
          commitToken: validToken,
        })
      ).rejects.toMatchObject({ code: 'LOCK_FORBIDDEN' });
    }

    const error = await vault
      .commitLockChallenge(bruteForceParams, now + 20_000, {
        callerKey: CALLER_KEY_A,
        commitToken: validToken,
      })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
  });

  it('isolates new-style lock_commit buckets by caller token', async () => {
    const now = 1_730_000_100_000;
    const record = createChannelRecord(CHANNEL_STATE.WAITING);
    const lockParams = createCommitLockParams();
    const { state, snapshot } = createMockState(record);
    const vault = new SecretVault(state, env);
    const challenge = await vault.beginLockChallenge(record.uuid, now, { callerKey: CALLER_KEY_A });
    const storedChallenge = snapshot.get(LOCK_CHALLENGE_KEY) as StoredLockChallenge;
    const callerAToken = await createBoundCommitToken(
      'lock',
      record.uuid,
      storedChallenge,
      CALLER_KEY_A
    );
    const callerBToken = await createBoundCommitToken(
      'lock',
      record.uuid,
      storedChallenge,
      CALLER_KEY_B
    );
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
        vault.commitLockChallenge(bruteForceParams, now + 1_000 + attempt, {
          callerKey: CALLER_KEY_A,
          commitToken: callerAToken,
        })
      ).rejects.toMatchObject({ code: 'LOCK_FORBIDDEN' });
    }

    const rateLimitError = await vault
      .commitLockChallenge(bruteForceParams, now + 7_000, {
        callerKey: CALLER_KEY_A,
        commitToken: callerAToken,
      })
      .catch((caught) => caught);

    expect(rateLimitError).toBeInstanceOf(RateLimitError);
    await expect(
      vault.commitLockChallenge(bruteForceParams, now + 8_000, {
        callerKey: CALLER_KEY_B,
        commitToken: callerBToken,
      })
    ).rejects.toMatchObject({ code: 'LOCK_FORBIDDEN' });
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

  it('returns the same internal compound commit token for the same caller and active challenge', async () => {
    const now = 1_730_001_100_000;
    const dateNowMock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(createCommitLockParams());
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);

    const firstResponse = await vault.fetch(
      new Request('https://zerolink.test/compound_begin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_CALLER_KEY_HEADER]: CALLER_KEY_A,
        },
        body: JSON.stringify({ uuid: lockedRecord.uuid }),
      })
    );
    const secondResponse = await vault.fetch(
      new Request('https://zerolink.test/compound_begin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_CALLER_KEY_HEADER]: CALLER_KEY_A,
        },
        body: JSON.stringify({ uuid: lockedRecord.uuid }),
      })
    );

    expect(firstResponse.headers.get(INTERNAL_COMMIT_COOKIE_ACTION_HEADER)).toBe('set');
    expect(firstResponse.headers.get(INTERNAL_COMMIT_COOKIE_KIND_HEADER)).toBe('compound');
    expect(firstResponse.headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER)).toBe(
      secondResponse.headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER)
    );
    expect(firstResponse.headers.get(INTERNAL_COMMIT_COOKIE_EXP_HEADER)).toBe(
      secondResponse.headers.get(INTERNAL_COMMIT_COOKIE_EXP_HEADER)
    );

    dateNowMock.mockRestore();
  });

  it('returns different internal compound commit tokens for different callers on the same active challenge', async () => {
    const now = 1_730_001_100_000;
    const dateNowMock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(createCommitLockParams());
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);

    const callerAResponse = await vault.fetch(
      new Request('https://zerolink.test/compound_begin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_CALLER_KEY_HEADER]: CALLER_KEY_A,
        },
        body: JSON.stringify({ uuid: lockedRecord.uuid }),
      })
    );
    const callerBResponse = await vault.fetch(
      new Request('https://zerolink.test/compound_begin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_CALLER_KEY_HEADER]: CALLER_KEY_B,
        },
        body: JSON.stringify({ uuid: lockedRecord.uuid }),
      })
    );

    expect(callerAResponse.headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER)).toBeTruthy();
    expect(callerAResponse.headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER)).not.toBe(
      callerBResponse.headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER)
    );

    dateNowMock.mockRestore();
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

  it('does not spend new-style compound_commit quota before token validation passes', async () => {
    const now = 1_730_001_875_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING, 'softkey')
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const verifySoftkeySignatureMock = vi.mocked(softkeyCrypto.verifySoftkeySignature);
    verifySoftkeySignatureMock.mockResolvedValue({
      ok: false,
      error: 'bad softkey signature',
    });

    await vault.beginCompoundChallenge(lockedRecord.uuid, now, { callerKey: CALLER_KEY_A });
    const storedChallenge = snapshot.get(COMPOUND_CHALLENGE_KEY) as StoredCompoundChallenge;
    const validToken = await createBoundCommitToken(
      'compound',
      lockedRecord.uuid,
      storedChallenge,
      CALLER_KEY_A
    );
    const validIntent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + 20_000),
      asBase64Url('nonce_compound_token_valid'),
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

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await expect(
        vault.commitCompound(bruteForceParams, now + 1_000 + attempt, {
          callerKey: CALLER_KEY_A,
          commitToken: undefined,
        })
      ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        vault.commitCompound(bruteForceParams, now + 20_000 + attempt, {
          callerKey: CALLER_KEY_A,
          commitToken: validToken,
        })
      ).rejects.toMatchObject({ code: 'ASSERTION_INVALID' });
    }

    const error = await vault
      .commitCompound(bruteForceParams, now + 31_000, {
        callerKey: CALLER_KEY_A,
        commitToken: validToken,
      })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    verifySoftkeySignatureMock.mockReset();
  });

  it('isolates new-style compound_commit buckets by caller token', async () => {
    const now = 1_730_001_890_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING, 'softkey')
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const verifySoftkeySignatureMock = vi.mocked(softkeyCrypto.verifySoftkeySignature);
    verifySoftkeySignatureMock.mockResolvedValue({
      ok: false,
      error: 'bad softkey signature',
    });

    await vault.beginCompoundChallenge(lockedRecord.uuid, now, { callerKey: CALLER_KEY_A });
    const storedChallenge = snapshot.get(COMPOUND_CHALLENGE_KEY) as StoredCompoundChallenge;
    const callerAToken = await createBoundCommitToken(
      'compound',
      lockedRecord.uuid,
      storedChallenge,
      CALLER_KEY_A
    );
    const callerBToken = await createBoundCommitToken(
      'compound',
      lockedRecord.uuid,
      storedChallenge,
      CALLER_KEY_B
    );
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + 1_000),
      asBase64Url('nonce_compound_token_isolation'),
      lockParams.receiverPubFpr
    );
    const intentHash = await computeIntentHash(toRecord(intent));
    const bruteForceParams = {
      adminMode: 'softkey' as const,
      uuid: lockedRecord.uuid,
      softkeySignature: asHex(
        'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef'
      ),
      intentHash,
      intent,
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        vault.commitCompound(bruteForceParams, now + 2_000 + attempt, {
          callerKey: CALLER_KEY_A,
          commitToken: callerAToken,
        })
      ).rejects.toMatchObject({ code: 'ASSERTION_INVALID' });
    }

    const rateLimitError = await vault
      .commitCompound(bruteForceParams, now + 20_000, {
        callerKey: CALLER_KEY_A,
        commitToken: callerAToken,
      })
      .catch((caught) => caught);

    expect(rateLimitError).toBeInstanceOf(RateLimitError);
    await expect(
      vault.commitCompound(bruteForceParams, now + 21_000, {
        callerKey: CALLER_KEY_B,
        commitToken: callerBToken,
      })
    ).rejects.toMatchObject({ code: 'ASSERTION_INVALID' });
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
    await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + 1_000),
      asBase64Url('nonce_update_01'),
      lockParams.receiverPubFpr
    );
    const intentHash = await computeIntentHash(toRecord(intent));
    const expectedChallenge = await deriveUpdateProofChallengeB64u({
      uuid: lockedRecord.uuid,
      intentHash,
    });
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
    expect(updated.updateDeliveryProof).toEqual({
      adminMode: 'webauthn',
      meta: {
        version: intent.version,
        timestamp: intent.timestamp,
        nonce: intent.nonce,
        expireAt: intent.expireAt,
      },
      proof: {
        clientDataJSON: assertionFixture.assertion.response.clientDataJSON,
        authenticatorData: assertionFixture.assertion.response.authenticatorData,
        signature: assertionFixture.assertion.response.signature,
      },
    });
    expect((updated.adminCredential as StoredCredential).signCount).toBe(7);
    expect(nonceRecord.expiresAt).toBe(expectedNonceExpiry);
    expect(nonceIndexKey).toBe(createNonceIndexKey(expectedNonceExpiry, intent.nonce));
    expect(consumedChallenge.consumedAt).toBeDefined();
    expect(getAlarm()).toBe(Number(expectedNonceExpiry));
  });

  it('returns decrypt payload with cipherVersion derived from the delivered record version', async () => {
    const now = 1_730_001_150_000;
    const lockParams = createCommitLockParams();
    const deliveredRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const intent = createUpdateIntent(
      deliveredRecord.uuid,
      deliveredRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_payload_01'),
      lockParams.receiverPubFpr
    );
    const updatedRecord = new SecretVaultStateMachine(deliveredRecord).commitDelivery({
      cipherBundle: intent.cipherBundle,
      deliveredAt: intent.timestamp,
    });
    const { state } = createMockState(updatedRecord);
    const vault = new SecretVault(state, env);

    const response = await vault.fetch(
      new Request('https://zerolink.test/get_decrypt_payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    const payload = (await response.json()) as {
      ok: true;
      cipherBundle: CipherBundle;
      receiverPubFpr: HexString;
      cipherVersion: number;
      deliveredAt: UnixMs;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      cipherBundle: intent.cipherBundle,
      receiverPubFpr: lockParams.receiverPubFpr,
      cipherVersion: intent.version,
      deliveredAt: intent.timestamp,
    });
  });

  it('returns deliveryAuth for delivered records with stored update proofs', async () => {
    const now = 1_730_001_175_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_delivery_auth_01'),
      lockParams.receiverPubFpr
    );
    const assertionFixture = await createMockAssertion({
      credentialId: (lockedRecord.adminCredential as StoredCredential).credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: await deriveUpdateProofChallengeB64u({
        uuid: lockedRecord.uuid,
        intentHash: await computeIntentHash(toRecord(intent)),
      }),
      signCount: 11,
    });
    const updatedRecord = new SecretVaultStateMachine({
      ...lockedRecord,
      adminCredential: {
        ...(lockedRecord.adminCredential as StoredCredential),
        publicKey: assertionFixture.publicKeyCose,
      },
    }).commitDelivery({
      cipherBundle: intent.cipherBundle,
      deliveredAt: intent.timestamp,
      updateDeliveryProof: {
        adminMode: 'webauthn',
        meta: {
          version: intent.version,
          timestamp: intent.timestamp,
          nonce: intent.nonce,
          expireAt: intent.expireAt,
        },
        proof: {
          clientDataJSON: assertionFixture.assertion.response.clientDataJSON,
          authenticatorData: assertionFixture.assertion.response.authenticatorData,
          signature: assertionFixture.assertion.response.signature,
        },
      },
    });
    const { state } = createMockState(updatedRecord);
    const vault = new SecretVault(state, env);

    const response = await vault.fetch(
      new Request('https://zerolink.test/get_decrypt_payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    const payload = (await response.json()) as {
      ok: true;
      cipherBundle: CipherBundle;
      receiverPubFpr: HexString;
      cipherVersion: number;
      deliveredAt: UnixMs;
      deliveryAuth: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      cipherBundle: intent.cipherBundle,
      receiverPubFpr: lockParams.receiverPubFpr,
      cipherVersion: intent.version,
      deliveredAt: intent.timestamp,
      deliveryAuth: {
        adminMode: 'webauthn',
        meta: {
          version: intent.version,
          timestamp: intent.timestamp,
          nonce: intent.nonce,
          expireAt: intent.expireAt,
        },
        signer: {
          credentialId: (updatedRecord.adminCredential as StoredCredential).credentialId,
          publicKey: assertionFixture.publicKeyCose,
        },
        proof: {
          clientDataJSON: assertionFixture.assertion.response.clientDataJSON,
          authenticatorData: assertionFixture.assertion.response.authenticatorData,
          signature: assertionFixture.assertion.response.signature,
        },
      },
    });
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

  it('rejects compound commit when ciphertextHash does not match ciphertext', async () => {
    const now = 1_730_001_360_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_bundle_hash_01'),
      lockParams.receiverPubFpr
    );
    intent.cipherBundle = createCipherBundle(
      lockedRecord.uuid,
      lockedRecord.version,
      lockParams.receiverPubFpr,
      {
        ciphertextHash: asHex('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
      }
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
    ).rejects.toMatchObject({ code: 'CIPHER_BUNDLE_INVALID' });
  });

  it('rejects compound commit when aad version does not match intent.version', async () => {
    const now = 1_730_001_370_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_bundle_aad_version_01'),
      lockParams.receiverPubFpr
    );
    intent.cipherBundle = createCipherBundle(
      lockedRecord.uuid,
      lockedRecord.version + 1,
      lockParams.receiverPubFpr
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
    ).rejects.toMatchObject({ code: 'CIPHER_BUNDLE_INVALID' });
  });

  it('rejects compound commit when aad receiver fingerprint does not match locked receiver', async () => {
    const now = 1_730_001_380_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_bundle_aad_fpr_01'),
      lockParams.receiverPubFpr
    );
    intent.cipherBundle = createCipherBundle(
      lockedRecord.uuid,
      lockedRecord.version,
      asHex('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
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
    ).rejects.toMatchObject({ code: 'CIPHER_BUNDLE_INVALID' });
  });

  it('rejects compound commit when ciphertext is not valid base64url', async () => {
    const now = 1_730_001_390_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_bundle_b64_01'),
      lockParams.receiverPubFpr
    );
    intent.cipherBundle = {
      ...createCipherBundle(lockedRecord.uuid, lockedRecord.version, lockParams.receiverPubFpr),
      ciphertext: 'invalid+/ciphertext' as Base64Url,
    };
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
    ).rejects.toMatchObject({ code: 'CIPHER_BUNDLE_INVALID' });
  });

  it('rejects compound commit with nonce replay', async () => {
    const now = 1_730_001_400_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_replay_01'),
      lockParams.receiverPubFpr
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
          uuid: lockedRecord.uuid,
          assertion: createAssertionFixture(
            (lockedRecord.adminCredential as StoredCredential).credentialId
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
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + TIMESTAMP_SKEW_MS + 1),
      asBase64Url('nonce_time_01'),
      lockParams.receiverPubFpr
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
    ).rejects.toMatchObject({ code: 'TIMESTAMP_OUT_OF_RANGE' });
  });

  it('rejects compound commit when intent hash mismatches', async () => {
    const now = 1_730_001_600_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_hash_01'),
      lockParams.receiverPubFpr
    );

    await expect(
      vault.commitCompound(
        {
          uuid: lockedRecord.uuid,
          assertion: createAssertionFixture(
            (lockedRecord.adminCredential as StoredCredential).credentialId
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
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_missing_01'),
      lockParams.receiverPubFpr
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
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
  });

  it('rejects compound commit when assertion is invalid', async () => {
    const now = 1_730_001_800_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    const begin = await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + 1_000),
      asBase64Url('nonce_assert_01'),
      lockParams.receiverPubFpr
    );
    const intentHash = await computeIntentHash(toRecord(intent));
    const wrongChallenge = await computeCompoundChallengeValue(
      lockedRecord.uuid,
      begin.challenge.id,
      intentHash,
      begin.challenge.seed
    );
    const assertionFixture = await createMockAssertion({
      credentialId: (lockedRecord.adminCredential as StoredCredential).credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: wrongChallenge,
      signCount: 5,
    });

    await expect(
      vault.commitCompound(
        {
          uuid: lockedRecord.uuid,
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
    expect(verifySoftkeySignatureMock).toHaveBeenCalledWith({
      softkeyPubJwk: (lockedRecord.adminCredential as { softkeyPubJwk: unknown }).softkeyPubJwk,
      payload: decodeBase64Url(
        await deriveUpdateProofChallengeB64u({
          uuid: lockedRecord.uuid,
          intentHash,
        })
      ),
      signatureHex: asHex(
        'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef'
      ),
    });
    expect(updated.updateDeliveryProof).toEqual({
      adminMode: 'softkey',
      meta: {
        version: intent.version,
        timestamp: intent.timestamp,
        nonce: intent.nonce,
        expireAt: intent.expireAt,
      },
      proof: {
        softkeySignature: asHex(
          'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef'
        ),
      },
    });

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
