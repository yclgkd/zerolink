import type {
  Base64Url,
  CipherBundle,
  HexString,
  MultipartFileRef,
  StoredCredential,
  UnixMs,
} from '@zerolink/shared';
import {
  CHALLENGE_TTL_MS,
  CHANNEL_STATE,
  computeIntentHash,
  deriveUpdateProofChallengeB64u,
  NONCE_TTL_MS,
} from '@zerolink/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createMockR2Bucket } from '../../__tests__/helpers/r2-fixtures.ts';
import { createMockAssertion } from '../../__tests__/helpers/webauthn-fixtures.ts';
import {
  CHANNEL_RECORD_KEY,
  COMPOUND_CHALLENGE_KEY,
  NONCE_INDEX_KEY_PREFIX,
  NONCE_KEY_PREFIX,
  SecretVault,
  SecretVaultStateMachine,
  type StoredCompoundChallenge,
  TERMINAL_TOMBSTONE_KEY,
} from '../SecretVault.ts';
import {
  asBase64Url,
  asHex,
  asUnixMs,
  computeCompoundChallengeValue,
  createAssertionFixture,
  createChannelRecord,
  createCipherBundle,
  createCommitLockParams,
  createDeleteIntent,
  createMockState,
  createNonceIndexKey,
  createUpdateIntent,
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
    intent.expireAt = asUnixMs(1_930_000_000_000);
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
    expect(updated.expiresAt).toBe(intent.expireAt);
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

  it('rejects a WebAuthn compound commit when signCount rolls back', async () => {
    const now = 1_730_001_101_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now + 1_000),
      asBase64Url('nonce_sign_count_rollback'),
      lockParams.receiverPubFpr
    );
    const intentHash = await computeIntentHash(toRecord(intent));
    const assertionFixture = await createMockAssertion({
      credentialId: (lockedRecord.adminCredential as StoredCredential).credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: await deriveUpdateProofChallengeB64u({
        uuid: lockedRecord.uuid,
        intentHash,
      }),
      signCount: 2,
    });

    snapshot.set(CHANNEL_RECORD_KEY, {
      ...lockedRecord,
      adminCredential: {
        ...lockedRecord.adminCredential,
        publicKey: assertionFixture.publicKeyCose,
        signCount: 3,
      },
    });

    await expect(
      vault.commitCompound(
        {
          uuid: lockedRecord.uuid,
          assertion: assertionFixture.assertion,
          intentHash,
          intent,
        },
        now + 1_000
      )
    ).rejects.toMatchObject({ code: 'ASSERTION_INVALID' });
  });

  it('rejects update intent when expireAt is a past timestamp', async () => {
    const now = 1_730_001_100_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = {
      ...createUpdateIntent(
        lockedRecord.uuid,
        lockedRecord.version,
        asUnixMs(now + 1_000),
        asBase64Url('nonce_past_expire'),
        lockParams.receiverPubFpr
      ),
      expireAt: asUnixMs(1),
    };
    const intentHash = await computeIntentHash(toRecord(intent));
    const assertionFixture = await createMockAssertion({
      credentialId: (lockedRecord.adminCredential as StoredCredential).credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: await deriveUpdateProofChallengeB64u({ uuid: lockedRecord.uuid, intentHash }),
      signCount: 5,
    });

    snapshot.set(CHANNEL_RECORD_KEY, {
      ...lockedRecord,
      adminCredential: {
        ...lockedRecord.adminCredential,
        publicKey: assertionFixture.publicKeyCose,
        signCount: 3,
      },
    });

    await expect(
      vault.commitCompound(
        { uuid: lockedRecord.uuid, assertion: assertionFixture.assertion, intentHash, intent },
        now + 1_000
      )
    ).rejects.toMatchObject({ code: 'TIMESTAMP_OUT_OF_RANGE' });
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
    const cipherBundle = intent.cipherBundle;
    if (!cipherBundle) {
      throw new Error('cipherBundle fixture is missing');
    }
    const updatedRecord = new SecretVaultStateMachine(deliveredRecord).commitDelivery({
      cipherBundle,
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
      payloadTransport: 'inline';
      cipherBundle: CipherBundle;
      receiverPubFpr: HexString;
      cipherVersion: number;
      deliveredAt: UnixMs;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      payloadTransport: 'inline',
      cipherBundle,
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
    const cipherBundle = intent.cipherBundle;
    if (!cipherBundle) {
      throw new Error('cipherBundle fixture is missing');
    }
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
      cipherBundle,
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
      payloadTransport: 'inline';
      cipherBundle: CipherBundle;
      receiverPubFpr: HexString;
      cipherVersion: number;
      deliveredAt: UnixMs;
      deliveryAuth: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      payloadTransport: 'inline',
      cipherBundle,
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

  it('returns multipart decrypt payloads and cleans up R2 objects on delete', async () => {
    const now = 1_730_001_180_000;
    const fileBucket = createMockR2Bucket();
    const localEnv = { ...env, FILE_BUCKET: fileBucket };
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);

    const storageKey0 = 'files/abcdefghijklmnopqrstu/0000.bin';
    const storageKey1 = 'files/abcdefghijklmnopqrstu/0001.bin';
    await fileBucket.put(storageKey0, 'cipher-0');
    await fileBucket.put(storageKey1, 'cipher-1');

    const fileRef: MultipartFileRef = {
      storageBackend: 'r2',
      chunkSizeBytes: 8,
      chunkCount: 2,
      totalPlaintextBytes: 8,
      totalCiphertextBytes: 16,
      baseIv: asBase64Url('base_iv'),
      encContentKey: asBase64Url('enc_key'),
      chunks: [
        {
          index: 0,
          storageKey: storageKey0,
          ciphertextBytes: 8,
          ciphertextHash: asHex('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        },
        {
          index: 1,
          storageKey: storageKey1,
          ciphertextBytes: 8,
          ciphertextHash: asHex('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        },
      ],
    };

    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_payload_multipart'),
      lockParams.receiverPubFpr
    );
    delete intent.cipherBundle;
    intent.payloadKind = 'file';
    intent.fileRef = fileRef;

    const intentHash = await computeIntentHash(toRecord(intent));
    const assertionFixture = await createMockAssertion({
      credentialId: (lockedRecord.adminCredential as StoredCredential).credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: await deriveUpdateProofChallengeB64u({
        uuid: lockedRecord.uuid,
        intentHash,
      }),
      signCount: 13,
    });

    const { state } = createMockState({
      ...lockedRecord,
      adminCredential: {
        ...(lockedRecord.adminCredential as StoredCredential),
        publicKey: assertionFixture.publicKeyCose,
      },
    });
    const vault = new SecretVault(state, localEnv);
    await vault.beginCompoundChallenge(lockedRecord.uuid, now);

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
    expect(updated.state).toBe(CHANNEL_STATE.DELIVERED);
    expect(updated.fileRef).toEqual(fileRef);
    expect(updated.cipherBundle).toBeUndefined();

    const response = await vault.fetch(
      new Request('https://zerolink.test/get_decrypt_payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    const payload = (await response.json()) as {
      ok: true;
      payloadTransport: 'multipart';
      fileRef: typeof fileRef;
      receiverPubFpr: HexString;
      cipherVersion: number;
      deliveredAt: UnixMs;
    };

    expect(response.status).toBe(200);
    expect(payload.payloadTransport).toBe('multipart');
    expect(payload.fileRef).toEqual(fileRef);

    await vault.commitDelete();
    await expect(fileBucket.head(storageKey0)).resolves.toBeNull();
    await expect(fileBucket.head(storageKey1)).resolves.toBeNull();
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

  it('rejects file compound commit when inline ciphertext is supplied', async () => {
    const now = 1_730_001_395_000;
    const lockParams = createCommitLockParams();
    const lockedRecord = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const { state, snapshot } = createMockState(lockedRecord);
    const vault = new SecretVault(state, env);
    await vault.beginCompoundChallenge(lockedRecord.uuid, now);
    const intent = createUpdateIntent(
      lockedRecord.uuid,
      lockedRecord.version,
      asUnixMs(now),
      asBase64Url('nonce_bundle_size_01'),
      lockParams.receiverPubFpr
    );
    intent.payloadKind = 'file';
    intent.cipherBundle = createCipherBundle(
      lockedRecord.uuid,
      lockedRecord.version,
      lockParams.receiverPubFpr
    );
    const intentHash = await computeIntentHash(toRecord(intent));
    const assertionFixture = await createMockAssertion({
      credentialId: (lockedRecord.adminCredential as StoredCredential).credentialId,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge: await deriveUpdateProofChallengeB64u({
        uuid: lockedRecord.uuid,
        intentHash,
      }),
      signCount: 5,
    });

    snapshot.set(CHANNEL_RECORD_KEY, {
      ...lockedRecord,
      adminCredential: {
        ...lockedRecord.adminCredential,
        publicKey: assertionFixture.publicKeyCose,
        signCount: 3,
      },
    });

    await expect(
      vault.commitCompound(
        {
          uuid: lockedRecord.uuid,
          assertion: assertionFixture.assertion,
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
});
