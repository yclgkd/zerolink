import type { StoredCredential, UnixMs } from '@zerolink/shared';
import {
  CHANNEL_STATE,
  computeIntentHash,
  deriveUpdateProofChallengeB64u,
  TIMESTAMP_SKEW_MS,
} from '@zerolink/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createMockAssertion } from '../../__tests__/helpers/webauthn-fixtures.ts';
import * as softkeyCrypto from '../../crypto/softkey.ts';
import {
  CHANNEL_RECORD_KEY,
  NONCE_INDEX_KEY_PREFIX,
  NONCE_KEY_PREFIX,
  SecretVault,
  SecretVaultStateMachine,
  TERMINAL_TOMBSTONE_KEY,
} from '../SecretVault.ts';
import {
  asBase64Url,
  asHex,
  asUnixMs,
  computeCompoundChallengeValue,
  createAssertionFixture,
  createChannelRecord,
  createCommitLockParams,
  createMockState,
  createNonceIndexKey,
  createUpdateIntent,
  decodeBase64Url,
  env,
  RP_ID,
  RP_ORIGIN,
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

describe('SecretVault compound/delete flow', () => {
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
