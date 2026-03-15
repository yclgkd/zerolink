import type { Base64Url, LockChallenge, UnixMs } from '@zerolink/shared';
import { CHALLENGE_TTL_MS, CHANNEL_STATE } from '@zerolink/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  INTERNAL_CALLER_KEY_HEADER,
  INTERNAL_COMMIT_COOKIE_ACTION_HEADER,
  INTERNAL_COMMIT_COOKIE_EXP_HEADER,
  INTERNAL_COMMIT_COOKIE_KIND_HEADER,
  INTERNAL_COMMIT_COOKIE_TOKEN_HEADER,
} from '../../commitTokens.ts';
import {
  type CommitLockChallengeParams,
  LOCK_CHALLENGE_KEY,
  SecretVault,
  type StoredLockChallenge,
} from '../SecretVault.ts';
import {
  asBase64Url,
  asHex,
  asUnixMs,
  CALLER_KEY_A,
  CALLER_KEY_B,
  computeLockProof,
  createChannelRecord,
  createCommitLockParams,
  createMockState,
  decodeBase64Url,
  encodeBase64Url,
  env,
  legacyLockChallengeStorageKey,
  setupRealReceiverKey,
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
});
