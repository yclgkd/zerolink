import type {
  AssertionJSON,
  Base64Url,
  CompoundBeginResponse,
  FileSharePolicy,
  HexString,
} from '@zerolink/shared';
import {
  AES_GCM,
  buildCipherBundleAadBytes,
  computeIntentHash,
  deriveUpdateProofChallengeB64u,
  encodeFileSharePayload,
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
  normalizePassphrase,
  randomBase64Url,
  resolveInlineFilePolicy,
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
  beginData: ResolvedDeliverBeginData,
  filePolicy?: FileSharePolicy
): Promise<
  CryptoOrchestratorResult<{
    intent: UpdateIntent;
    intentHash: HexString;
    expectedChallenge: Base64Url;
    cipherBundle: DeliverSecretOutput['cipherBundle'];
    payloadKind: DeliverSecretOutput['payloadKind'];
  }>
> {
  let plaintextBytes: Uint8Array | null = null;
  let aad: Uint8Array | null = null;
  let rawContentKey: Uint8Array | null = null;
  let encrypted: Awaited<ReturnType<typeof encryptAesGcm>> | null = null;
  let encContentKey: Uint8Array | null = null;
  let payloadKind: DeliverSecretOutput['payloadKind'] = 'text';
  let maxPlaintextBytes: number | undefined;

  try {
    if (input.file) {
      const { policy, inlineMaxBytes } = resolveInlineFilePolicy(filePolicy);
      if (input.file.bytes.byteLength > policy.maxFileBytes) {
        return toError(
          'FILE_TOO_LARGE',
          'deliver.file-policy',
          `Selected file exceeds the deployment limit (${policy.maxFileBytes} bytes).`
        );
      }
      plaintextBytes = encodeFileSharePayload({
        fileName: input.file.fileName,
        mediaType: input.file.mediaType,
        bytes: input.file.bytes,
      });
      // Compare the full envelope (magic + header + body) against the inline
      // limit. The envelope is always larger than the raw file bytes due to
      // framing overhead, so this is the authoritative check.
      if (plaintextBytes.byteLength > inlineMaxBytes) {
        return toError(
          'MULTIPART_REQUIRED',
          'deliver.file-policy',
          'Selected file exceeds the inline delivery limit for this deployment.'
        );
      }
      maxPlaintextBytes = inlineMaxBytes;
      payloadKind = 'file';
    } else {
      plaintextBytes = toPlaintextBytes(input.plaintext);
    }
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
      ...(maxPlaintextBytes ? { maxPlaintextBytes } : {}),
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
      payloadKind,
      cipherBundle,
      expireAt: input.expireAt == null ? null : asUnixMs(input.expireAt),
    };

    const intentHash = await computeIntentHash(intent as unknown as Record<string, unknown>);
    const expectedChallenge = await deriveUpdateProofChallengeB64u({
      uuid: input.uuid,
      intentHash,
    });

    return {
      ok: true,
      data: { intent, intentHash, expectedChallenge, cipherBundle, payloadKind },
    };
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

  let filePolicy: FileSharePolicy | undefined;
  if (input.file) {
    const filePolicyRes = await deps.client.filePolicy();
    if (!filePolicyRes.ok) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit(filePolicyRes.error.code);
      });
      return toError(filePolicyRes.error.code, 'deliver.file-policy.fetch');
    }
    filePolicy = filePolicyRes.data.policy;
  }

  let intentData: Awaited<ReturnType<typeof buildDeliverUpdateIntent>>;
  try {
    intentData = await buildDeliverUpdateIntent(deps, input, resolvedBeginData, filePolicy);
  } catch {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundCommit('CRYPTO_ERROR');
    });
    return toError('CRYPTO_ERROR', 'deliver.crypto');
  }
  if (!intentData.ok) {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundCommit(intentData.error.code);
    });
    return intentData;
  }
  const resolvedIntentData = intentData.data;

  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.startCompoundCommit();
  });

  let assertion: AssertionJSON | undefined;
  let softkeySignature: HexString | undefined;

  const deliverIsPasswordMode =
    resolvedBeginData.adminMode === 'password' || resolvedBeginData.adminMode === 'softkey';

  if (deliverIsPasswordMode) {
    const softkeyPassphrase = input.softkeyPassphrase ?? '';
    const passphraseError = ensurePassphrase(
      softkeyPassphrase,
      'deliver.softkey-passphrase',
      'Channel password'
    );
    if (passphraseError) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('PASSPHRASE_REQUIRED');
      });
      return passphraseError;
    }
    const normalizedSoftkeyPassphrase = normalizePassphrase(softkeyPassphrase);
    if (!input.wrappedPrivateKey) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('CRYPTO_ERROR');
      });
      return toError('CRYPTO_ERROR', 'deliver.softkey', 'missing wrapped key in manage URL');
    }
    try {
      softkeySignature = await signChallengeWithWrappedKey(
        input.wrappedPrivateKey,
        normalizedSoftkeyPassphrase,
        resolvedIntentData.expectedChallenge as Base64Url,
        deps.kdfParams
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
          challenge: resolvedIntentData.expectedChallenge,
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
        intentHash: resolvedIntentData.intentHash,
        intent: resolvedIntentData.intent,
      }
    : {
        uuid: input.uuid,
        assertion: assertion as AssertionJSON,
        intentHash: resolvedIntentData.intentHash,
        intent: resolvedIntentData.intent,
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

  return { ok: true, data: resolvedIntentData };
}
