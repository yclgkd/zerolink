import type { Base64Url, HexString, LockChallenge, UUID } from '@zerolink/shared';
import { computeIntentHash, deriveUpdateProofChallengeB64u } from '@zerolink/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyAttestation } from '../crypto/attestation.ts';
import {
  asBase64Url,
  asUnixMs,
  asUuid,
  computeLockProof,
  createCipherBundle,
  createCommitLockParams,
  createLockKey,
  createUpdateIntent,
  RP_ID,
  RP_ORIGIN,
  setupRealReceiverKey,
  toRecord,
} from '../do/__tests__/helpers/vault-fixtures.ts';
import { createMockAuthenticator } from './helpers/webauthn-fixtures.ts';
import { VALID_ATTESTATION } from './helpers/worker-fixtures.ts';
import {
  asCallerHeaders,
  createWorkerProtocolHarness,
  getCookieHeader,
} from './helpers/worker-protocol-fixtures.ts';

vi.mock('../crypto/attestation.ts', () => ({
  verifyAttestation: vi.fn(),
}));

interface CompoundBeginPayload {
  ok: true;
  challenge: {
    id: Base64Url;
    seed: Base64Url;
    expiresAt: number;
  };
  currentVersion: number;
}

interface LockBeginPayload {
  ok: true;
  lockChallenge: LockChallenge;
}

function makeUuid(seed: number): UUID {
  return asUuid(`pr${String(seed).padStart(19, '0')}`);
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  const payload = (await response.json()) as { ok: false; code: string };
  expect(response.status).toBe(status);
  expect(payload).toEqual({ ok: false, code });
}

async function createSecureLockedChannel(seed: number) {
  const harness = createWorkerProtocolHarness();
  const uuid = makeUuid(seed);
  const credentialId = asBase64Url(`credential_${String(seed).padStart(4, '0')}`);
  const authenticator = await createMockAuthenticator(credentialId);
  const lockKeyB64u = createLockKey();

  vi.mocked(verifyAttestation).mockResolvedValueOnce({
    verified: true,
    fmt: 'none',
    credentialId: authenticator.credentialId,
    publicKey: authenticator.publicKeyCose,
    aaguid: asBase64Url(`aaguid_${String(seed).padStart(4, '0')}`),
    signCount: 1,
  });

  const createBeginResponse = await harness.dispatch(`/api/create_begin/${uuid}`, 'POST', {
    uuid,
    timestamp: Date.now(),
    securityProfile: 'secure',
  });
  expect(createBeginResponse.status).toBe(200);

  const createFinishResponse = await harness.dispatch(`/api/create_finish/${uuid}`, 'POST', {
    uuid,
    adminMode: 'webauthn',
    attestation: VALID_ATTESTATION,
    lockKeyB64u,
    timestamp: Date.now(),
  });
  expect(createFinishResponse.status).toBe(200);

  const receiver = createCommitLockParams();
  const lockBeginResponse = await harness.dispatch(
    `/api/lock_begin/${uuid}`,
    'POST',
    { uuid },
    asCallerHeaders()
  );
  const lockBegin = (await lockBeginResponse.json()) as LockBeginPayload;
  expect(lockBeginResponse.status).toBe(200);

  const lockCookie = getCookieHeader(lockBeginResponse, 'zl-lock-commit');
  expect(lockCookie).toBeTruthy();

  const lockProof = await computeLockProof(uuid, lockBegin.lockChallenge, lockKeyB64u);
  const lockCommitResponse = await harness.dispatch(
    `/api/lock_commit/${uuid}`,
    'POST',
    {
      uuid,
      lockChallengeId: lockBegin.lockChallenge.id,
      lockProof,
      receiverPubJwk: receiver.receiverPubJwk,
      receiverPubFpr: receiver.receiverPubFpr,
      lockedAt: asUnixMs(Date.now() + 1_000),
    },
    asCallerHeaders(lockCookie)
  );
  expect(lockCommitResponse.status).toBe(200);

  return {
    harness,
    uuid,
    authenticator,
    receiverPubFpr: receiver.receiverPubFpr,
  };
}

async function beginCompound(harness: ReturnType<typeof createWorkerProtocolHarness>, uuid: UUID) {
  const response = await harness.dispatch(
    `/api/manage/compound_begin/${uuid}`,
    'POST',
    { uuid },
    asCallerHeaders()
  );
  const payload = (await response.json()) as CompoundBeginPayload;
  expect(response.status).toBe(200);

  const cookieHeader = getCookieHeader(response, 'zl-compound-commit');
  expect(cookieHeader).toBeTruthy();

  return { payload, cookieHeader };
}

async function signUpdateProof(params: {
  authenticator: Awaited<ReturnType<typeof createMockAuthenticator>>;
  uuid: UUID;
  intentHash: HexString;
  signCount: number;
  challengeOverride?: Base64Url;
}) {
  return params.authenticator.signAssertion({
    rpId: RP_ID,
    rpOrigin: RP_ORIGIN,
    challenge:
      params.challengeOverride ??
      (await deriveUpdateProofChallengeB64u({
        uuid: params.uuid,
        intentHash: params.intentHash,
      })),
    signCount: params.signCount,
  });
}

beforeAll(async () => {
  await setupRealReceiverKey();
});

beforeEach(() => {
  vi.mocked(verifyAttestation).mockReset();
});

describe('worker protocol regression suite', () => {
  it('keeps the secure happy path green through real worker routes', async () => {
    const { harness, uuid, authenticator, receiverPubFpr } = await createSecureLockedChannel(1);
    const { payload, cookieHeader } = await beginCompound(harness, uuid);
    const intent = createUpdateIntent(
      uuid,
      payload.currentVersion,
      asUnixMs(Date.now()),
      asBase64Url('nonce_success_000001'),
      receiverPubFpr
    );
    const intentHash = (await computeIntentHash(toRecord(intent))) as HexString;
    const assertion = await signUpdateProof({
      authenticator,
      uuid,
      intentHash,
      signCount: 2,
    });

    const commitResponse = await harness.dispatch(
      `/api/manage/compound_commit/${uuid}`,
      'POST',
      { uuid, intentHash, intent, assertion },
      asCallerHeaders(cookieHeader)
    );
    expect(commitResponse.status).toBe(200);
    await expect(commitResponse.json()).resolves.toEqual({ ok: true });

    const publicResponse = await harness.dispatch(`/api/public/${uuid}`, 'GET');
    await expect(publicResponse.json()).resolves.toMatchObject({
      ok: true,
      state: 'delivered',
      adminMode: 'webauthn',
      securityProfile: 'secure',
    });

    const decryptResponse = await harness.dispatch(`/api/decrypt_fetch/${uuid}`, 'GET');
    await expect(decryptResponse.json()).resolves.toMatchObject({
      ok: true,
      payloadTransport: 'inline',
      receiverPubFpr,
      cipherVersion: 0,
    });
  });

  it('rejects lock_commit with an invalid lockProof', async () => {
    const harness = createWorkerProtocolHarness();
    const uuid = makeUuid(2);
    const authenticator = await createMockAuthenticator(asBase64Url('credential_0002'));

    vi.mocked(verifyAttestation).mockResolvedValueOnce({
      verified: true,
      fmt: 'none',
      credentialId: authenticator.credentialId,
      publicKey: authenticator.publicKeyCose,
      aaguid: asBase64Url('aaguid_0002'),
      signCount: 1,
    });

    await harness.dispatch(`/api/create_begin/${uuid}`, 'POST', {
      uuid,
      timestamp: Date.now(),
      securityProfile: 'secure',
    });
    await harness.dispatch(`/api/create_finish/${uuid}`, 'POST', {
      uuid,
      adminMode: 'webauthn',
      attestation: VALID_ATTESTATION,
      lockKeyB64u: createLockKey(),
      timestamp: Date.now(),
    });

    const receiver = createCommitLockParams();
    const lockBeginResponse = await harness.dispatch(
      `/api/lock_begin/${uuid}`,
      'POST',
      { uuid },
      asCallerHeaders()
    );
    const lockBegin = (await lockBeginResponse.json()) as LockBeginPayload;
    const lockCookie = getCookieHeader(lockBeginResponse, 'zl-lock-commit');

    const response = await harness.dispatch(
      `/api/lock_commit/${uuid}`,
      'POST',
      {
        uuid,
        lockChallengeId: lockBegin.lockChallenge.id,
        lockProof: '0'.repeat(64),
        receiverPubJwk: receiver.receiverPubJwk,
        receiverPubFpr: receiver.receiverPubFpr,
        lockedAt: asUnixMs(Date.now() + 1_000),
      },
      asCallerHeaders(lockCookie)
    );

    await expectError(response, 403, 'LOCK_FORBIDDEN');
  });

  it('rejects compound_commit when intentHash does not match the payload', async () => {
    const { harness, uuid, authenticator, receiverPubFpr } = await createSecureLockedChannel(3);
    const { payload, cookieHeader } = await beginCompound(harness, uuid);
    const intent = createUpdateIntent(
      uuid,
      payload.currentVersion,
      asUnixMs(Date.now()),
      asBase64Url('nonce_hash_mismatch'),
      receiverPubFpr
    );
    const wrongIntentHash = 'f'.repeat(64) as HexString;
    const assertion = await signUpdateProof({
      authenticator,
      uuid,
      intentHash: wrongIntentHash,
      signCount: 2,
    });

    const response = await harness.dispatch(
      `/api/manage/compound_commit/${uuid}`,
      'POST',
      { uuid, intentHash: wrongIntentHash, intent, assertion },
      asCallerHeaders(cookieHeader)
    );

    await expectError(response, 400, 'INTENT_HASH_MISMATCH');
  });

  it('rejects nonce replay on a second authenticated update', async () => {
    const { harness, uuid, authenticator, receiverPubFpr } = await createSecureLockedChannel(4);
    const sharedNonce = asBase64Url('nonce_replay_same_val');

    const firstBegin = await beginCompound(harness, uuid);
    const firstIntent = createUpdateIntent(
      uuid,
      firstBegin.payload.currentVersion,
      asUnixMs(Date.now()),
      sharedNonce,
      receiverPubFpr
    );
    const firstIntentHash = (await computeIntentHash(toRecord(firstIntent))) as HexString;
    const firstAssertion = await signUpdateProof({
      authenticator,
      uuid,
      intentHash: firstIntentHash,
      signCount: 2,
    });

    const firstCommit = await harness.dispatch(
      `/api/manage/compound_commit/${uuid}`,
      'POST',
      { uuid, intentHash: firstIntentHash, intent: firstIntent, assertion: firstAssertion },
      asCallerHeaders(firstBegin.cookieHeader)
    );
    expect(firstCommit.status).toBe(200);

    const secondBegin = await beginCompound(harness, uuid);
    const secondIntent = createUpdateIntent(
      uuid,
      secondBegin.payload.currentVersion,
      asUnixMs(Date.now() + 10),
      sharedNonce,
      receiverPubFpr
    );
    const secondIntentHash = (await computeIntentHash(toRecord(secondIntent))) as HexString;
    const secondAssertion = await signUpdateProof({
      authenticator,
      uuid,
      intentHash: secondIntentHash,
      signCount: 3,
    });

    const secondCommit = await harness.dispatch(
      `/api/manage/compound_commit/${uuid}`,
      'POST',
      { uuid, intentHash: secondIntentHash, intent: secondIntent, assertion: secondAssertion },
      asCallerHeaders(secondBegin.cookieHeader)
    );

    await expectError(secondCommit, 409, 'NONCE_REPLAY');
  });

  it('rejects stale-version commits after a successful delivery', async () => {
    const { harness, uuid, authenticator, receiverPubFpr } = await createSecureLockedChannel(5);

    const firstBegin = await beginCompound(harness, uuid);
    const firstIntent = createUpdateIntent(
      uuid,
      firstBegin.payload.currentVersion,
      asUnixMs(Date.now()),
      asBase64Url('nonce_version_ok_01'),
      receiverPubFpr
    );
    const firstIntentHash = (await computeIntentHash(toRecord(firstIntent))) as HexString;
    const firstAssertion = await signUpdateProof({
      authenticator,
      uuid,
      intentHash: firstIntentHash,
      signCount: 2,
    });

    const firstCommit = await harness.dispatch(
      `/api/manage/compound_commit/${uuid}`,
      'POST',
      { uuid, intentHash: firstIntentHash, intent: firstIntent, assertion: firstAssertion },
      asCallerHeaders(firstBegin.cookieHeader)
    );
    expect(firstCommit.status).toBe(200);

    const staleBegin = await beginCompound(harness, uuid);
    const staleIntent = createUpdateIntent(
      uuid,
      0,
      asUnixMs(Date.now() + 20),
      asBase64Url('nonce_version_old_02'),
      receiverPubFpr
    );
    const staleIntentHash = (await computeIntentHash(toRecord(staleIntent))) as HexString;
    const staleAssertion = await signUpdateProof({
      authenticator,
      uuid,
      intentHash: staleIntentHash,
      signCount: 3,
    });

    const staleCommit = await harness.dispatch(
      `/api/manage/compound_commit/${uuid}`,
      'POST',
      { uuid, intentHash: staleIntentHash, intent: staleIntent, assertion: staleAssertion },
      asCallerHeaders(staleBegin.cookieHeader)
    );

    await expectError(staleCommit, 409, 'VERSION_MISMATCH');
  });

  it('rejects compound_commit with a mismatched WebAuthn assertion', async () => {
    const { harness, uuid, authenticator, receiverPubFpr } = await createSecureLockedChannel(6);
    const { payload, cookieHeader } = await beginCompound(harness, uuid);
    const intent = createUpdateIntent(
      uuid,
      payload.currentVersion,
      asUnixMs(Date.now()),
      asBase64Url('nonce_bad_assertion'),
      receiverPubFpr
    );
    const intentHash = (await computeIntentHash(toRecord(intent))) as HexString;
    const assertion = await signUpdateProof({
      authenticator,
      uuid,
      intentHash,
      signCount: 2,
      challengeOverride: asBase64Url('wrong_assertion_chal'),
    });

    const response = await harness.dispatch(
      `/api/manage/compound_commit/${uuid}`,
      'POST',
      { uuid, intentHash, intent, assertion },
      asCallerHeaders(cookieHeader)
    );

    await expectError(response, 403, 'ASSERTION_INVALID');
  });

  it('rejects update payloads whose ciphertextHash fails integrity validation', async () => {
    const { harness, uuid, authenticator, receiverPubFpr } = await createSecureLockedChannel(7);
    const { payload, cookieHeader } = await beginCompound(harness, uuid);
    const intent = createUpdateIntent(
      uuid,
      payload.currentVersion,
      asUnixMs(Date.now()),
      asBase64Url('nonce_bad_cipherhash'),
      receiverPubFpr
    );
    intent.cipherBundle = createCipherBundle(uuid, payload.currentVersion, receiverPubFpr, {
      ciphertextHash: 'f'.repeat(64) as HexString,
    });
    const intentHash = (await computeIntentHash(toRecord(intent))) as HexString;
    const assertion = await signUpdateProof({
      authenticator,
      uuid,
      intentHash,
      signCount: 2,
    });

    const response = await harness.dispatch(
      `/api/manage/compound_commit/${uuid}`,
      'POST',
      { uuid, intentHash, intent, assertion },
      asCallerHeaders(cookieHeader)
    );

    await expectError(response, 400, 'CIPHER_BUNDLE_INVALID');
  });
});
