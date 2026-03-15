import type { DecryptFetchResponse } from '@zerolink/shared';
import {
  AES_GCM,
  buildCipherBundleAadBytes,
  computeCredentialPublicKeyFingerprint,
  computeIntentHash,
  computeSoftkeyPublicKeyFingerprint,
  decodeBase64Url,
  deriveUpdateProofChallengeB64u,
  type UpdateIntent,
  verifySoftkeyDeliveryProof,
  verifyWebAuthnDeliveryProof,
} from '@zerolink/shared';
import { decryptAesGcm, importAesKeyFromBytes, wipeBytes } from '@zerolink/shared/crypto/aes';
import { unwrapPrivateKey } from '@zerolink/shared/crypto/kdf';
import { unwrapContentKey } from '@zerolink/shared/crypto/rsa';
import type {
  CryptoOrchestratorResult,
  DecryptDeliveredInput,
  DecryptDeliveredOutput,
  ResolvedDeps,
} from './orchestrator-types';
import {
  applyDecryptStoreUpdate,
  asUuid,
  constantTimeHexEqual,
  ensurePassphrase,
  isDeliveredState,
  resolveRpId,
  resolveRpOrigin,
  toError,
  toStorageErrorCode,
} from './orchestrator-utils';
import { computeSha256Hex, decodeBase64UrlBytes, encodeBase64UrlBytes } from './protocol-utils';
import type { ReceiverKeyEnvelope } from './storage';

async function resolveAnchoredCipherVersion(
  payload: DecryptFetchResponse,
  envelope: ReceiverKeyEnvelope,
  uuid: string
): Promise<number> {
  try {
    if (!payload.deliveryAuth) {
      throw new Error('missing delivery auth');
    }

    const senderAuthFpr =
      payload.deliveryAuth.adminMode === 'webauthn'
        ? await computeCredentialPublicKeyFingerprint(payload.deliveryAuth.signer.publicKey)
        : await computeSoftkeyPublicKeyFingerprint(payload.deliveryAuth.signer.softkeyPubJwk);

    if (!constantTimeHexEqual(senderAuthFpr, envelope.senderAuthFpr ?? '')) {
      throw new Error('sender auth mismatch');
    }

    if (payload.cipherVersion !== payload.deliveryAuth.meta.version) {
      throw new Error('cipher version mismatch');
    }

    const signedIntent: UpdateIntent = {
      op: 'update',
      uuid: asUuid(uuid),
      version: payload.deliveryAuth.meta.version,
      timestamp: payload.deliveryAuth.meta.timestamp,
      nonce: payload.deliveryAuth.meta.nonce,
      receiverPubFpr: payload.receiverPubFpr,
      cipherBundle: payload.cipherBundle,
      expireAt: payload.deliveryAuth.meta.expireAt,
    };
    const intentHash = await computeIntentHash(signedIntent as unknown as Record<string, unknown>);
    const expectedChallenge = await deriveUpdateProofChallengeB64u({
      uuid,
      intentHash,
    });

    const proofValid =
      payload.deliveryAuth.adminMode === 'webauthn'
        ? await verifyWebAuthnDeliveryProof({
            deliveryAuth: payload.deliveryAuth,
            expectedChallenge,
            rpId: resolveRpId(),
            rpOrigin: resolveRpOrigin(),
          })
        : await verifySoftkeyDeliveryProof({
            softkeyPubJwk: payload.deliveryAuth.signer.softkeyPubJwk,
            signatureHex: payload.deliveryAuth.proof.softkeySignature,
            expectedChallengeBytes: decodeBase64Url(expectedChallenge),
          });

    if (!proofValid) {
      throw new Error('invalid delivery proof');
    }

    return payload.deliveryAuth.meta.version;
  } catch {
    throw new Error('INTEGRITY_MISMATCH');
  }
}

async function resolveCipherVersionForDecrypt(
  payload: DecryptFetchResponse,
  envelope: ReceiverKeyEnvelope,
  uuid: string
): Promise<number> {
  if (!constantTimeHexEqual(payload.receiverPubFpr, envelope.receiverPubFpr)) {
    throw new Error('INTEGRITY_MISMATCH');
  }

  const hasPinnedSenderAuth = Boolean(envelope.senderAuthFpr);
  const hasDeliveryAuth = payload.deliveryAuth !== undefined;

  if (hasPinnedSenderAuth || hasDeliveryAuth) {
    if (!hasPinnedSenderAuth || !hasDeliveryAuth) {
      throw new Error('INTEGRITY_MISMATCH');
    }

    return resolveAnchoredCipherVersion(payload, envelope, uuid);
  }

  return payload.cipherVersion;
}

function assertMonotonicDeliveryState(
  envelope: ReceiverKeyEnvelope,
  version: number,
  ciphertextHash: string
): void {
  const lastAccepted = envelope.lastAcceptedDelivery;
  if (!lastAccepted) {
    return;
  }

  if (version < lastAccepted.version) {
    throw new Error('INTEGRITY_MISMATCH');
  }

  if (
    version === lastAccepted.version &&
    !constantTimeHexEqual(ciphertextHash, lastAccepted.ciphertextHash)
  ) {
    throw new Error('INTEGRITY_MISMATCH');
  }
}

async function performDecryptionPipeline(
  payload: DecryptFetchResponse,
  passphrase: string,
  envelope: ReceiverKeyEnvelope,
  uuid: string,
  cipherVersion: number
) {
  let ciphertextBytes: Uint8Array | null = null;
  let wrappedKeyBytes: Uint8Array | null = null;
  let ivBytes: Uint8Array | null = null;
  let aadBytes: Uint8Array | null = null;
  let contentKeyBytes: Uint8Array | null = null;
  let plaintextBytes: Uint8Array | null = null;

  try {
    aadBytes = buildCipherBundleAadBytes({
      uuid: asUuid(uuid),
      version: cipherVersion,
      receiverPubFpr: envelope.receiverPubFpr,
    });
    const expectedAad = encodeBase64UrlBytes(aadBytes);
    if (payload.cipherBundle.aad !== expectedAad) {
      throw new Error('INTEGRITY_MISMATCH');
    }

    ciphertextBytes = decodeBase64UrlBytes(payload.cipherBundle.ciphertext);
    const computedHash = await computeSha256Hex(ciphertextBytes);
    if (!constantTimeHexEqual(computedHash, payload.cipherBundle.ciphertextHash)) {
      throw new Error('INTEGRITY_MISMATCH');
    }

    const receiverPrivateKey = await unwrapPrivateKey({
      wrapped: envelope.wrappedPrivateKey,
      password: passphrase,
    });
    wrappedKeyBytes = decodeBase64UrlBytes(payload.cipherBundle.encContentKey);
    contentKeyBytes = await unwrapContentKey({
      receiverPrivateKey,
      wrappedKey: wrappedKeyBytes,
    });
    // L-4: Validate content key is exactly 32 bytes (AES-256)
    if (contentKeyBytes.byteLength !== AES_GCM.KEY_LENGTH_BITS / 8) {
      throw new Error('INTEGRITY_MISMATCH');
    }
    const contentKey = await importAesKeyFromBytes(contentKeyBytes, ['decrypt']);
    wipeBytes(contentKeyBytes);
    contentKeyBytes = null;
    ivBytes = decodeBase64UrlBytes(payload.cipherBundle.iv);
    plaintextBytes = await decryptAesGcm({
      key: contentKey,
      ciphertext: ciphertextBytes,
      iv: ivBytes,
      aad: aadBytes,
    });

    return {
      plaintext: new TextDecoder().decode(plaintextBytes),
    };
  } finally {
    wipeBytes(ciphertextBytes);
    wipeBytes(wrappedKeyBytes);
    wipeBytes(ivBytes);
    wipeBytes(aadBytes);
    wipeBytes(contentKeyBytes);
    wipeBytes(plaintextBytes);
  }
}

export async function executeDecryptDelivered(
  deps: ResolvedDeps,
  input: DecryptDeliveredInput
): Promise<CryptoOrchestratorResult<DecryptDeliveredOutput>> {
  const passErrResult = ensurePassphrase(input.passphrase, 'decrypt.validate');
  if (passErrResult) return passErrResult;

  applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
    state.startPublicStatus();
  });

  const statusRes = await deps.client.publicStatus(input.uuid);
  if (!statusRes.ok) {
    applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
      state.failPublicStatus(statusRes.error.code);
    });
    return toError(statusRes.error.code, 'decrypt.public-status');
  }
  applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
    state.completePublicStatus(statusRes.data);
  });
  if (!isDeliveredState(statusRes.data.state)) {
    return toError('CHANNEL_NOT_DELIVERED', 'decrypt.public-status');
  }

  applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
    state.startDecryptFetch();
  });
  const fetchRes = await deps.client.decryptFetch(input.uuid);
  if (!fetchRes.ok) {
    applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
      state.failDecryptFetch(fetchRes.error.code);
    });
    return toError(fetchRes.error.code, 'decrypt.fetch');
  }
  applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
    state.completeDecryptFetch(fetchRes.data as DecryptFetchResponse);
  });

  const payload = fetchRes.data;
  let envelope: ReceiverKeyEnvelope | null;
  try {
    envelope = await deps.receiverKeyStorage.load(input.uuid);
  } catch (error) {
    return toError(toStorageErrorCode(error), 'decrypt.load-key');
  }
  if (!envelope) return toError('KEY_STORAGE_ERROR', 'decrypt.load-key', 'missing key');

  try {
    const cipherVersion = await resolveCipherVersionForDecrypt(payload, envelope, input.uuid);
    assertMonotonicDeliveryState(envelope, cipherVersion, payload.cipherBundle.ciphertextHash);

    const { plaintext } = await performDecryptionPipeline(
      payload,
      input.passphrase,
      envelope,
      input.uuid,
      cipherVersion
    );
    try {
      await deps.receiverKeyStorage.save({
        ...envelope,
        lastAcceptedDelivery: {
          version: cipherVersion,
          ciphertextHash: payload.cipherBundle.ciphertextHash,
          acceptedAt: deps.now(),
        },
        updatedAt: deps.now(),
      });
    } catch (error) {
      return toError(toStorageErrorCode(error), 'decrypt.persist-state');
    }
    applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
      state.setPlaintext(plaintext);
    });

    return {
      ok: true,
      data: {
        plaintext,
        deliveredAt: payload.deliveredAt,
        receiverPubFpr: payload.receiverPubFpr,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'INTEGRITY_MISMATCH') {
      return toError('INTEGRITY_MISMATCH', 'decrypt.verify');
    }
    return toError('CRYPTO_ERROR', 'decrypt.crypto');
  }
}
