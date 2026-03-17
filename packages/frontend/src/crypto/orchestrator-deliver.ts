import type { AssertionJSON, Base64Url, CompoundBeginResponse, HexString } from '@zerolink/shared';
import {
  AES_GCM,
  buildCipherBundleAadBytes,
  computeIntentHash,
  deriveUpdateProofChallengeB64u,
  NONCE_BYTES,
  type UpdateIntent,
} from '@zerolink/shared';
import { encryptAesGcm, importAesKeyFromBytes, wipeBytes } from '@zerolink/shared/crypto/aes';
import { importReceiverPublicKeyFromJwk, wrapContentKey } from '@zerolink/shared/crypto/rsa';
import type {
  CryptoOrchestratorResult,
  DeliverSecretInput,
  DeliverSecretOutput,
  ResolvedDeliverBeginData,
  ResolvedDeps,
} from './orchestrator-types';
import {
  applyDeliverStoreUpdate,
  asUnixMs,
  asUuid,
  ensurePassphrase,
  mapWebAuthnError,
  randomBase64Url,
  resolvePadBlockForProfile,
  signChallengeWithWrappedKey,
  toCipherBundleTransport,
  toError,
  toPlaintextBytes,
} from './orchestrator-utils';
import { computeSha256Hex } from './protocol-utils';
import { assertWithWebAuthn } from './webauthn';

async function buildDeliverUpdateIntent(
  deps: ResolvedDeps,
  input: DeliverSecretInput,
  beginData: ResolvedDeliverBeginData
) {
  let plaintextBytes: Uint8Array | null = null;
  let aad: Uint8Array | null = null;
  let rawContentKey: Uint8Array | null = null;
  let encrypted: Awaited<ReturnType<typeof encryptAesGcm>> | null = null;
  let encContentKey: Uint8Array | null = null;

  try {
    plaintextBytes = toPlaintextBytes(input.plaintext);
    aad = buildCipherBundleAadBytes({
      uuid: asUuid(input.uuid),
      version: beginData.currentVersion,
      receiverPubFpr: beginData.receiverPubFpr,
    });
    rawContentKey = deps.randomBytes(AES_GCM.KEY_LENGTH_BITS / 8);
    const aesKey = await importAesKeyFromBytes(rawContentKey, ['encrypt', 'decrypt']);
    encrypted = await encryptAesGcm({
      key: aesKey,
      plaintext: plaintextBytes,
      aad,
      padBlock: resolvePadBlockForProfile(input.profile),
    });
    const receiverPublicKey = await importReceiverPublicKeyFromJwk(beginData.receiverPubJwk);
    encContentKey = await wrapContentKey({
      receiverPublicKey,
      contentKey: rawContentKey,
    });
    const ciphertextHash = await computeSha256Hex(encrypted.ciphertext);

    const cipherBundle = toCipherBundleTransport({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      aad,
      encContentKey,
      ciphertextHash,
      padBlock: encrypted.padBlock,
    });

    const intent: UpdateIntent = {
      op: 'update',
      uuid: asUuid(input.uuid),
      version: beginData.currentVersion,
      timestamp: asUnixMs(deps.now()),
      nonce: randomBase64Url(NONCE_BYTES, deps.randomBytes),
      receiverPubFpr: beginData.receiverPubFpr,
      cipherBundle,
      expireAt: input.expireAt == null ? null : asUnixMs(input.expireAt),
    };

    const intentHash = await computeIntentHash(intent as unknown as Record<string, unknown>);
    const expectedChallenge = await deriveUpdateProofChallengeB64u({
      uuid: input.uuid,
      intentHash,
    });

    return { intent, intentHash, expectedChallenge, cipherBundle };
  } finally {
    wipeBytes(plaintextBytes);
    wipeBytes(aad);
    wipeBytes(rawContentKey);
    wipeBytes(encContentKey);
    wipeBytes(encrypted?.iv);
    wipeBytes(encrypted?.ciphertext);
  }
}

export async function executeDeliverSecret(
  deps: ResolvedDeps,
  input: DeliverSecretInput
): Promise<CryptoOrchestratorResult<DeliverSecretOutput>> {
  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.startCompoundBegin();
  });

  const beginRes = await deps.client.compoundBegin({ uuid: input.uuid });
  if (!beginRes.ok) {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundBegin(beginRes.error.code);
    });
    return toError(beginRes.error.code, 'deliver.begin');
  }
  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.completeCompoundBegin(beginRes.data as CompoundBeginResponse);
  });

  const beginData = beginRes.data;
  if (!beginData.challenge) return toError('MISSING_LOCK_CHALLENGE', 'deliver.validate');
  if (!beginData.receiverPubJwk || !beginData.receiverPubFpr)
    return toError('MISSING_RECEIVER_IDENTITY', 'deliver.validate');

  const resolvedBeginData = {
    ...beginData,
    challenge: beginData.challenge,
    receiverPubJwk: beginData.receiverPubJwk,
    receiverPubFpr: beginData.receiverPubFpr,
  } as ResolvedDeliverBeginData;

  let intentData: Awaited<ReturnType<typeof buildDeliverUpdateIntent>>;
  try {
    intentData = await buildDeliverUpdateIntent(deps, input, resolvedBeginData);
  } catch {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundCommit('CRYPTO_ERROR');
    });
    return toError('CRYPTO_ERROR', 'deliver.crypto');
  }

  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.startCompoundCommit();
  });

  let assertion: AssertionJSON | undefined;
  let softkeySignature: HexString | undefined;

  const deliverIsPasswordMode =
    resolvedBeginData.adminMode === 'password' || resolvedBeginData.adminMode === 'softkey';

  if (deliverIsPasswordMode) {
    const softkeyPassphrase = input.softkeyPassphrase ?? '';
    const passphraseError = ensurePassphrase(softkeyPassphrase, 'deliver.softkey-passphrase');
    if (passphraseError) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('PASSPHRASE_REQUIRED');
      });
      return passphraseError;
    }
    if (!input.wrappedPrivateKey) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('CRYPTO_ERROR');
      });
      return toError('CRYPTO_ERROR', 'deliver.softkey', 'missing wrapped key in manage URL');
    }
    try {
      softkeySignature = await signChallengeWithWrappedKey(
        input.wrappedPrivateKey,
        softkeyPassphrase,
        intentData.expectedChallenge as Base64Url
      );
    } catch {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('CRYPTO_ERROR');
      });
      return toError('CRYPTO_ERROR', 'deliver.softkey');
    }
  } else {
    const assertRes = await assertWithWebAuthn({
      profile: input.profile,
      requestOptions: {
        publicKey: {
          challenge: intentData.expectedChallenge,
          ...(resolvedBeginData.allowCredentials
            ? { allowCredentials: resolvedBeginData.allowCredentials }
            : {}),
        },
      },
    });
    if (!assertRes.ok) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit(assertRes.error.code);
      });
      return mapWebAuthnError(assertRes.error.code, 'deliver.assert');
    }
    assertion = assertRes.data as AssertionJSON;
  }

  const commitPayload = softkeySignature
    ? {
        adminMode: resolvedBeginData.adminMode as 'password' | 'softkey',
        uuid: input.uuid,
        softkeySignature,
        intentHash: intentData.intentHash,
        intent: intentData.intent,
      }
    : {
        uuid: input.uuid,
        assertion: assertion as AssertionJSON,
        intentHash: intentData.intentHash,
        intent: intentData.intent,
      };

  const commitRes = await deps.client.compoundCommit(commitPayload);
  if (!commitRes.ok) {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundCommit(commitRes.error.code);
    });
    return toError(commitRes.error.code, 'deliver.commit');
  }

  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.completeCompoundCommit(commitRes.data);
    state.markDelivered();
  });

  return { ok: true, data: intentData };
}
