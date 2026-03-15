import type { UnixMs } from '@zerolink/shared';
import { CHALLENGE_TTL_MS, CHANNEL_STATE, computeIntentHash } from '@zerolink/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createCommitToken,
  INTERNAL_CALLER_KEY_HEADER,
  INTERNAL_COMMIT_COOKIE_ACTION_HEADER,
  INTERNAL_COMMIT_COOKIE_EXP_HEADER,
  INTERNAL_COMMIT_COOKIE_KIND_HEADER,
  INTERNAL_COMMIT_COOKIE_TOKEN_HEADER,
} from '../../commitTokens.ts';
import * as softkeyCrypto from '../../crypto/softkey.ts';
import {
  CHANNEL_RECORD_KEY,
  COMPOUND_CHALLENGE_KEY,
  type CommitLockChallengeParams,
  LOCK_CHALLENGE_KEY,
  RateLimitError,
  SecretVault,
  type SecretVaultEnv,
  SecretVaultStateMachine,
  type StoredCompoundChallenge,
  type StoredLockChallenge,
} from '../SecretVault.ts';
import {
  asBase64Url,
  asHex,
  asUnixMs,
  CALLER_KEY_A,
  CALLER_KEY_B,
  computeLockProof,
  createBoundCommitToken,
  createChannelRecord,
  createCommitLockParams,
  createMockState,
  createUpdateIntent,
  env,
  readTerminalTombstone,
  setupRealReceiverKey,
  toRecord,
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
