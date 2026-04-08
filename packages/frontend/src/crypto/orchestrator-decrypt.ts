import type { DecryptedSharePayload, DecryptFetchResponse } from '@zerolink/shared';
import {
  AES_GCM,
  buildCipherBundleAadBytes,
  computeCredentialPublicKeyFingerprint,
  computeIntentHash,
  computeSoftkeyPublicKeyFingerprint,
  decodeBase64Url,
  decodeSharePayload,
  deriveUpdateProofChallengeB64u,
  type UpdateIntent,
  verifySoftkeyDeliveryProof,
  verifyWebAuthnDeliveryProof,
} from '@zerolink/shared';
import { decryptAesGcm, importAesKeyFromBytes, wipeBytes } from '@zerolink/shared/crypto/aes';
import type { Argon2idKdfParams } from '@zerolink/shared/crypto/kdf';
import { unwrapPrivateKey } from '@zerolink/shared/crypto/kdf';
import { unwrapContentKey } from '@zerolink/shared/crypto/rsa';
import { decryptMultipartFile } from './orchestrator-multipart';
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
  normalizePassphrase,
  resolveRpId,
  resolveRpOrigin,
  toError,
  toStorageErrorCode,
} from './orchestrator-utils';
import { computeSha256Hex, decodeBase64UrlBytes, encodeBase64UrlBytes } from './protocol-utils';
import type { ReceiverKeyEnvelope } from './storage';

const textDecoder = new TextDecoder();

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
      ...(payload.deliveryAuth.meta.payloadKind
        ? { payloadKind: payload.deliveryAuth.meta.payloadKind }
        : {}),
      ...(payload.cipherBundle ? { cipherBundle: payload.cipherBundle } : {}),
      ...(payload.fileRef ? { fileRef: payload.fileRef } : {}),
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

function decodeInlineDeliveredPayload(plaintextBytes: Uint8Array): DecryptedSharePayload {
  return {
    kind: 'text',
    text: textDecoder.decode(plaintextBytes),
  };
}

function decodeMultipartDeliveredPayload(plaintextBytes: Uint8Array): DecryptedSharePayload {
  const decryptedPayload = decodeSharePayload(plaintextBytes);
  if (decryptedPayload.kind !== 'file') {
    throw new Error('INTEGRITY_MISMATCH');
  }
  return decryptedPayload;
}

function decodeDeliveredPayload(
  plaintextBytes: Uint8Array,
  declaredKind: 'text' | 'file' | undefined,
  isMultipart: boolean
): DecryptedSharePayload {
  if (isMultipart) {
    if (declaredKind === 'text') {
      throw new Error('INTEGRITY_MISMATCH');
    }
    return decodeMultipartDeliveredPayload(plaintextBytes);
  }

  if (declaredKind === 'file') {
    throw new Error('INTEGRITY_MISMATCH');
  }

  return decodeInlineDeliveredPayload(plaintextBytes);
}

function assertMonotonicDeliveryState(
  envelope: ReceiverKeyEnvelope,
  version: number,
  deliveryHash: string
): void {
  const lastAccepted = envelope.lastAcceptedDelivery;
  if (!lastAccepted) {
    return;
  }

  if (version < lastAccepted.version) {
    throw new Error('INTEGRITY_MISMATCH');
  }

  const previousHash = lastAccepted.deliveryHash ?? lastAccepted.ciphertextHash;
  if (
    version === lastAccepted.version &&
    (!previousHash || !constantTimeHexEqual(deliveryHash, previousHash))
  ) {
    throw new Error('INTEGRITY_MISMATCH');
  }
}

async function resolveDeliveredPayloadHash(payload: DecryptFetchResponse): Promise<string> {
  if (payload.cipherBundle) {
    return payload.cipherBundle.ciphertextHash;
  }
  if (payload.fileRef) {
    return computeIntentHash(payload.fileRef as unknown as Record<string, unknown>);
  }
  throw new Error('INTEGRITY_MISMATCH');
}

async function performInlineDecryptionPipeline(
  payload: DecryptFetchResponse,
  passphrase: string,
  envelope: ReceiverKeyEnvelope,
  uuid: string,
  cipherVersion: number,
  kdfParams?: Argon2idKdfParams
): Promise<{ plaintextBytes: Uint8Array }> {
  if (!payload.cipherBundle) {
    throw new Error('INTEGRITY_MISMATCH');
  }

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
      kdfParams,
    });
    wrappedKeyBytes = decodeBase64UrlBytes(payload.cipherBundle.encContentKey);
    contentKeyBytes = await unwrapContentKey({
      receiverPrivateKey,
      wrappedKey: wrappedKeyBytes,
    });
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
      plaintextBytes: plaintextBytes.slice(),
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
  const passErrResult = ensurePassphrase(input.passphrase, 'decrypt.validate', 'Passphrase');
  if (passErrResult) return passErrResult;
  const normalizedPassphrase = normalizePassphrase(input.passphrase);

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
  if (!envelope) {
    return toError('KEY_STORAGE_ERROR', 'decrypt.load-key', 'missing key');
  }

  try {
    const cipherVersion = await resolveCipherVersionForDecrypt(payload, envelope, input.uuid);
    const deliveryHash = await resolveDeliveredPayloadHash(payload);
    assertMonotonicDeliveryState(envelope, cipherVersion, deliveryHash);

    const plaintextResult = payload.fileRef
      ? await decryptMultipartFile(
          deps,
          input.uuid,
          payload.fileRef,
          normalizedPassphrase,
          envelope.wrappedPrivateKey
        )
      : await (async () => {
          const result = await performInlineDecryptionPipeline(
            payload,
            normalizedPassphrase,
            envelope,
            input.uuid,
            cipherVersion,
            deps.kdfParams
          );
          return {
            ok: true as const,
            data: result.plaintextBytes,
          };
        })();

    if (!plaintextResult.ok) {
      if (plaintextResult.error.code === 'INTEGRITY_MISMATCH') {
        return toError('INTEGRITY_MISMATCH', plaintextResult.error.stage);
      }
      if (plaintextResult.error.code === 'NETWORK_ERROR') {
        return toError('NETWORK_ERROR', plaintextResult.error.stage);
      }
      return toError('CRYPTO_ERROR', plaintextResult.error.stage);
    }

    const plaintextBytes = plaintextResult.data;
    const decryptedPayload = decodeDeliveredPayload(
      plaintextBytes,
      payload.deliveryAuth?.meta.payloadKind,
      payload.fileRef !== undefined
    );
    wipeBytes(plaintextBytes);
    try {
      await deps.receiverKeyStorage.save({
        ...envelope,
        lastAcceptedDelivery: {
          version: cipherVersion,
          deliveryHash,
          ...(payload.cipherBundle ? { ciphertextHash: payload.cipherBundle.ciphertextHash } : {}),
          acceptedAt: deps.now(),
        },
        updatedAt: deps.now(),
      });
    } catch (error) {
      return toError(toStorageErrorCode(error), 'decrypt.persist-state');
    }
    applyDecryptStoreUpdate(deps.decryptStore, input.uuid, (state) => {
      if (decryptedPayload.kind === 'file') {
        state.setFile(decryptedPayload);
        return;
      }
      state.setPlaintext(decryptedPayload.text);
    });

    return {
      ok: true,
      data: {
        deliveredAt: payload.deliveredAt,
        receiverPubFpr: payload.receiverPubFpr,
        cipherVersion,
        payload: decryptedPayload,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'INTEGRITY_MISMATCH') {
      return toError('INTEGRITY_MISMATCH', 'decrypt.verify');
    }
    return toError('CRYPTO_ERROR', 'decrypt.crypto');
  }
}
