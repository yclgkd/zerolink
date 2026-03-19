import type { HexString, LockBeginResponse, UnixMs } from '@zerolink/shared';
import type { Argon2idKdfParams } from '@zerolink/shared/crypto/kdf';
import { wrapPrivateKey } from '@zerolink/shared/crypto/kdf';
import { exportReceiverPublicKeyToJwk, generateReceiverKeyPair } from '@zerolink/shared/crypto/rsa';
import type {
  CryptoOrchestratorResult,
  LockChannelInput,
  LockChannelOutput,
  ResolvedDeps,
} from './orchestrator-types';
import {
  asUnixMs,
  asUuid,
  computeReceiverPubFingerprint,
  ensurePassphrase,
  parseLockSecret,
  toApiReceiverPubJwk,
  toError,
  toStorageErrorCode,
} from './orchestrator-utils';
import { deriveLockKeyB64u, deriveLockProofHex } from './protocol-utils';
import { deriveSafetyCodeDisplay } from './safety-code-derive';

async function prepareLockCryptography(
  uuid: string,
  lockSecretB64u: string,
  passphrase: string,
  lockChallengeId: string,
  lockChallenge: string,
  nowMs: number,
  kdfParams?: Argon2idKdfParams,
  senderAuthFpr?: HexString
) {
  const receiverKeyPair = await generateReceiverKeyPair();
  const receiverPubJwk = await exportReceiverPublicKeyToJwk(receiverKeyPair.publicKey);
  const receiverPubFpr = await computeReceiverPubFingerprint(receiverKeyPair.publicKey);

  const lockKeyB64u = await deriveLockKeyB64u(uuid, lockSecretB64u);
  const lockProof = await deriveLockProofHex({
    uuid,
    lockChallengeId,
    lockChallenge,
    lockKeyB64u,
  });

  const wrappedPrivateKey = await wrapPrivateKey({
    privateKey: receiverKeyPair.privateKey,
    password: passphrase,
    kdfParams,
  });

  return {
    receiverPubJwk,
    receiverPubFpr,
    lockProof,
    envelope: {
      uuid: asUuid(uuid),
      receiverPubFpr,
      ...(senderAuthFpr ? { senderAuthFpr } : {}),
      wrappedPrivateKey,
      updatedAt: nowMs,
    },
  };
}

export async function executeLockChannel(
  deps: ResolvedDeps,
  input: LockChannelInput
): Promise<CryptoOrchestratorResult<LockChannelOutput>> {
  const errPass = ensurePassphrase(input.passphrase, 'lock.validate');
  if (errPass) return errPass;
  const errLock = parseLockSecret(input.lockSecretB64u);
  if (errLock) return errLock;

  const state = deps.lockStore.getState();
  state.setPassphrase(input.passphrase);
  state.startLockBegin();

  const beginRes = await deps.client.lockBegin({ uuid: input.uuid });
  if (!beginRes.ok) {
    state.failLockBegin(beginRes.error.code);
    return toError(beginRes.error.code, 'lock.begin');
  }
  state.completeLockBegin(beginRes.data as LockBeginResponse);

  const challenge = beginRes.data.lockChallenge;
  if (!challenge) return toError('MISSING_LOCK_CHALLENGE', 'lock.begin');

  const nowMs = deps.now();
  let cryptoData: Awaited<ReturnType<typeof prepareLockCryptography>>;
  try {
    cryptoData = await prepareLockCryptography(
      input.uuid,
      input.lockSecretB64u,
      input.passphrase,
      challenge.id,
      challenge.challenge,
      nowMs,
      deps.kdfParams,
      input.senderAuthFpr
    );
  } catch {
    return toError('CRYPTO_ERROR', 'lock.crypto');
  }

  try {
    await deps.receiverKeyStorage.save(cryptoData.envelope);
  } catch (error) {
    return toError(toStorageErrorCode(error), 'lock.persist');
  }

  state.startLockCommit();
  const lockedAt = asUnixMs(nowMs) as UnixMs;
  const commitRes = await deps.client.lockCommit({
    uuid: input.uuid,
    lockChallengeId: challenge.id,
    lockProof: cryptoData.lockProof,
    receiverPubJwk: toApiReceiverPubJwk(cryptoData.receiverPubJwk),
    receiverPubFpr: cryptoData.receiverPubFpr,
    lockedAt,
  });
  if (!commitRes.ok) {
    state.failLockCommit(commitRes.error.code);
    return toError(commitRes.error.code, 'lock.commit');
  }

  state.completeLockCommit(commitRes.data);
  state.setReceiverIdentity({
    receiverPubJwk: cryptoData.receiverPubJwk,
    receiverPubFpr: cryptoData.receiverPubFpr,
    lockedAt,
  });
  state.setSafetyCode(deriveSafetyCodeDisplay(cryptoData.receiverPubFpr));
  state.markLocked();

  return {
    ok: true,
    data: {
      receiverPubJwk: cryptoData.receiverPubJwk,
      receiverPubFpr: cryptoData.receiverPubFpr,
    },
  };
}
