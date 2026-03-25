import {
  type Base64Url,
  buildCipherBundleAadBytes,
  CHALLENGE_BYTES,
  CHALLENGE_TTL_MS,
  type ChannelRecord,
  type CompoundChallenge,
  computeIntentHash,
  DOMAIN,
  deriveUpdateProofChallengeB64u,
  type HexString,
  NONCE_TTL_MS,
  type NonceRecord,
  type RSAPublicKeyJWK,
  type SoftkeyCredential,
  type StoredCredential,
  type StoredUpdateDeliveryProof,
  TIMESTAMP_SKEW_MS,
  type UpdateIntent,
} from '@zerolink/shared';
import {
  COMMIT_TOKEN_MODE,
  type CommitCookieKind,
  type CommitCookieSignal,
} from '../commitTokens.ts';
import {
  asUnixMs,
  constantTimeEqual,
  decodeBase64Url,
  encodeBase64Url,
  getCryptoApi,
  sha256Bytes,
  sha256Hex,
  toUtf8Bytes,
} from '../crypto/bytes.ts';
import { verifySoftkeySignature } from '../crypto/softkey.ts';
import { verifyAssertion } from '../crypto/webauthn.ts';
import {
  buildCommitCookieSignal,
  shouldClearCommitCookie,
  validateCommitToken,
  withCommitCookieSignalError,
} from './SecretVaultCookies.ts';
import { assertUuidMatch } from './SecretVaultHttp.ts';
import { enforceRateLimit } from './SecretVaultRateLimit.ts';
import { SecretVaultStateMachine } from './SecretVaultStateMachine.ts';
import {
  closeAllWebSockets,
  finalizeTerminalState,
  loadActiveRecord,
  saveRecord,
  scheduleNextAlarm,
} from './SecretVaultStorage.ts';
import {
  COMPOUND_CHALLENGE_ID_BYTES,
  COMPOUND_CHALLENGE_KEY,
  type CompoundCommitParams,
  nonceIndexStorageKey,
  nonceStorageKey,
  StateTransitionError,
  type StoredCompoundChallenge,
  type VaultContext,
} from './SecretVaultTypes.ts';
import { broadcastToWebSockets, buildStateChangedMessage } from './SecretVaultWebSocket.ts';

interface BeginRequestContext {
  callerKey: Base64Url | undefined;
}

interface CommitRequestContext extends BeginRequestContext {
  commitToken: string | undefined;
}

// ---------------------------------------------------------------------------
// Cipher bundle validation (used by commitCompoundInternal)
// ---------------------------------------------------------------------------

async function validateCipherBundle(
  intent: UpdateIntent,
  lockedReceiverPubFpr: HexString
): Promise<void> {
  let ciphertextBytes: Uint8Array;
  try {
    ciphertextBytes = decodeBase64Url(intent.cipherBundle.ciphertext);
  } catch {
    throw new StateTransitionError(
      'CIPHER_BUNDLE_INVALID',
      'cipherBundle.ciphertext is not valid base64url'
    );
  }

  const computedHash = await sha256Hex([ciphertextBytes]);
  if (!constantTimeEqual(computedHash, intent.cipherBundle.ciphertextHash)) {
    throw new StateTransitionError(
      'CIPHER_BUNDLE_INVALID',
      'cipherBundle.ciphertextHash does not match ciphertext'
    );
  }

  const expectedAad = encodeBase64Url(
    buildCipherBundleAadBytes({
      uuid: intent.uuid,
      version: intent.version,
      receiverPubFpr: lockedReceiverPubFpr,
    })
  );
  if (!constantTimeEqual(intent.cipherBundle.aad, expectedAad)) {
    throw new StateTransitionError(
      'CIPHER_BUNDLE_INVALID',
      'cipherBundle.aad does not match the expected binding'
    );
  }
}

// ---------------------------------------------------------------------------
// Update delivery proof builder
// ---------------------------------------------------------------------------

function buildUpdateDeliveryProof(
  intent: UpdateIntent,
  params: CompoundCommitParams
): StoredUpdateDeliveryProof {
  const meta = {
    version: intent.version,
    timestamp: intent.timestamp,
    nonce: intent.nonce,
    expireAt: intent.expireAt,
  };

  if ('softkeySignature' in params) {
    return {
      adminMode: params.adminMode,
      meta,
      proof: {
        softkeySignature: params.softkeySignature,
      },
    };
  }

  return {
    adminMode: 'webauthn',
    meta,
    proof: {
      clientDataJSON: params.assertion.response.clientDataJSON,
      authenticatorData: params.assertion.response.authenticatorData,
      signature: params.assertion.response.signature,
    },
  };
}

// ---------------------------------------------------------------------------
// Public module-level functions
// ---------------------------------------------------------------------------

export async function beginCompoundChallengeInternal(
  vc: VaultContext,
  uuid: string,
  now: number = Date.now(),
  context: BeginRequestContext = { callerKey: undefined }
): Promise<{
  response: {
    challenge: CompoundChallenge;
    allowCredentials?: Array<{
      id: Base64Url;
      type: 'public-key';
    }>;
    receiverPubFpr?: HexString;
    receiverPubJwk?: RSAPublicKeyJWK;
    currentVersion: number;
    securityProfile: ChannelRecord['securityProfile'];
    adminMode: ChannelRecord['adminMode'];
  };
  commitCookieSignal?: CommitCookieSignal;
}> {
  return vc.ctx.blockConcurrencyWhile(async () => {
    const record = await loadActiveRecord(vc, now);
    assertUuidMatch(record.uuid, uuid);

    const existingChallenge =
      await vc.ctx.storage.get<StoredCompoundChallenge>(COMPOUND_CHALLENGE_KEY);
    const activeChallenge =
      existingChallenge &&
      existingChallenge.consumedAt === undefined &&
      existingChallenge.expiresAt > now
        ? existingChallenge
        : null;
    let challenge = activeChallenge;

    if (!challenge) {
      enforceRateLimit(vc, 'compound_begin', now);

      const cryptoApi = getCryptoApi();
      const id = encodeBase64Url(
        cryptoApi.getRandomValues(new Uint8Array(COMPOUND_CHALLENGE_ID_BYTES))
      );
      const seed = encodeBase64Url(cryptoApi.getRandomValues(new Uint8Array(CHALLENGE_BYTES)));
      const issuedAt = asUnixMs(now);
      const expiresAt = asUnixMs(now + CHALLENGE_TTL_MS);
      challenge = context.callerKey
        ? {
            id,
            seed,
            issuedAt,
            expiresAt,
            commitTokenMode: COMMIT_TOKEN_MODE,
          }
        : { id, seed, expiresAt };

      await vc.ctx.storage.put(COMPOUND_CHALLENGE_KEY, challenge);
    }

    const response: {
      challenge: CompoundChallenge;
      allowCredentials?: Array<{
        id: Base64Url;
        type: 'public-key';
      }>;
      currentVersion: number;
      receiverPubFpr?: HexString;
      receiverPubJwk?: RSAPublicKeyJWK;
      securityProfile: ChannelRecord['securityProfile'];
      adminMode: ChannelRecord['adminMode'];
    } = {
      challenge: {
        id: challenge.id,
        seed: challenge.seed,
        expiresAt: challenge.expiresAt,
      },
      currentVersion: record.version,
      securityProfile: record.securityProfile,
      adminMode: record.adminMode,
    };
    if (record.adminMode === 'webauthn') {
      const storedCredential = record.adminCredential as StoredCredential;
      if (storedCredential.credentialId) {
        response.allowCredentials = [
          {
            id: storedCredential.credentialId,
            type: 'public-key',
          },
        ];
      }
    }
    if (record.receiver) {
      response.receiverPubFpr = record.receiver.pubFpr;
      response.receiverPubJwk = record.receiver.pubJwk;
    }

    const commitCookieSignal = await buildCommitCookieSignal(
      vc,
      'compound',
      record.uuid,
      challenge,
      context.callerKey
    );

    return {
      response,
      ...(commitCookieSignal ? { commitCookieSignal } : {}),
    };
  });
}

export async function commitCompoundInternal(
  vc: VaultContext,
  params: CompoundCommitParams,
  now: number = Date.now(),
  context: CommitRequestContext = { callerKey: undefined, commitToken: undefined }
): Promise<{ commitCookieSignal?: CommitCookieSignal }> {
  await vc.ctx.blockConcurrencyWhile(async () => {
    const record = await loadActiveRecord(vc, now);
    assertUuidMatch(record.uuid, params.uuid);

    const { intent } = params;
    if (intent.uuid !== record.uuid) {
      throw new StateTransitionError('LOCK_FORBIDDEN', 'intent uuid mismatch');
    }

    if (intent.version !== record.version) {
      throw new StateTransitionError(
        'VERSION_MISMATCH',
        `expected version ${record.version}, got ${intent.version}`
      );
    }

    // M-2: Cross-validate intent.receiverPubFpr against stored receiver fingerprint
    if (intent.op === 'update' && record.receiver) {
      if (intent.receiverPubFpr !== record.receiver.pubFpr) {
        throw new StateTransitionError(
          'LOCK_FORBIDDEN',
          'intent receiverPubFpr does not match locked receiver fingerprint'
        );
      }
    }

    const skew = Math.abs(intent.timestamp - now);
    if (skew > TIMESTAMP_SKEW_MS) {
      throw new StateTransitionError(
        'TIMESTAMP_OUT_OF_RANGE',
        `timestamp skew ${skew}ms exceeds ${TIMESTAMP_SKEW_MS}ms`
      );
    }

    const nonceKey = nonceStorageKey(intent.nonce);
    const existingNonce = await vc.ctx.storage.get<NonceRecord>(nonceKey);
    if (existingNonce) {
      if (existingNonce.expiresAt > now) {
        throw new StateTransitionError('NONCE_REPLAY', 'nonce already consumed');
      }

      await vc.ctx.storage.delete([
        nonceKey,
        nonceIndexStorageKey(existingNonce.expiresAt, existingNonce.nonce),
      ]);
    }

    const computedHash = await computeIntentHash(intent as unknown as Record<string, unknown>);
    if (!constantTimeEqual(computedHash, params.intentHash)) {
      throw new StateTransitionError('INTENT_HASH_MISMATCH', 'intent hash does not match');
    }

    const challenge = await vc.ctx.storage.get<StoredCompoundChallenge>(COMPOUND_CHALLENGE_KEY);
    if (!challenge) {
      throw withCommitCookieSignalError(
        'compound',
        'CHALLENGE_INVALID',
        'compound challenge not found',
        context.commitToken ? { action: 'clear', kind: 'compound' } : undefined
      );
    }
    if (challenge.consumedAt !== undefined) {
      throw withCommitCookieSignalError(
        'compound',
        'CHALLENGE_CONSUMED',
        'compound challenge already consumed',
        shouldClearCommitCookie(challenge, context.commitToken)
          ? { action: 'clear', kind: 'compound' }
          : undefined
      );
    }
    if (challenge.expiresAt <= now) {
      await vc.ctx.storage.delete(COMPOUND_CHALLENGE_KEY);
      throw withCommitCookieSignalError(
        'compound',
        'CHALLENGE_INVALID',
        'compound challenge expired',
        shouldClearCommitCookie(challenge, context.commitToken)
          ? { action: 'clear', kind: 'compound' }
          : undefined
      );
    }

    const tokenHash = await validateCommitToken(vc, {
      kind: 'compound' as CommitCookieKind,
      uuid: record.uuid,
      challenge,
      now,
      callerKey: context.callerKey,
      commitToken: context.commitToken,
    });

    if (intent.op === 'update') {
      if (!record.receiver) {
        throw new StateTransitionError(
          'INVALID_TRANSITION',
          'delivery requires a locked receiver identity'
        );
      }

      await validateCipherBundle(intent, record.receiver.pubFpr);
    }

    enforceRateLimit(vc, 'compound_commit', now, tokenHash);

    const expectedChallenge =
      intent.op === 'update'
        ? await deriveUpdateProofChallengeB64u({
            uuid: record.uuid,
            intentHash: params.intentHash,
          })
        : encodeBase64Url(
            await sha256Bytes([
              toUtf8Bytes(DOMAIN.CHALLENGE),
              toUtf8Bytes(record.uuid),
              decodeBase64Url(challenge.id),
              toUtf8Bytes(params.intentHash),
              decodeBase64Url(challenge.seed),
            ])
          );
    const expectedChallengeBytes = decodeBase64Url(expectedChallenge);

    let verifiedWebAuthnSignCount: number | null = null;
    let updateDeliveryProof: StoredUpdateDeliveryProof | undefined;

    const isPasswordMode = record.adminMode === 'password' || record.adminMode === 'softkey';

    if (isPasswordMode) {
      if (
        !('adminMode' in params) ||
        (params.adminMode !== 'password' && params.adminMode !== 'softkey') ||
        !('softkeySignature' in params)
      ) {
        throw new StateTransitionError(
          'ASSERTION_INVALID',
          'password commit payload required for password/softkey channel'
        );
      }

      const verifyResult = await verifySoftkeySignature({
        softkeyPubJwk: (record.adminCredential as SoftkeyCredential).softkeyPubJwk,
        payload: expectedChallengeBytes,
        signatureHex: params.softkeySignature,
      });
      if (!verifyResult.ok) {
        throw new StateTransitionError('ASSERTION_INVALID', verifyResult.error);
      }
    } else {
      if (
        'adminMode' in params &&
        (params.adminMode === 'softkey' || params.adminMode === 'password')
      ) {
        throw new StateTransitionError(
          'ASSERTION_INVALID',
          'webauthn commit payload required for webauthn channel'
        );
      }

      const verifyResult = await verifyAssertion({
        // biome-ignore lint/suspicious/noExplicitAny: narrowing union after password/softkey guard
        assertion: (params as any).assertion,
        expectedChallenge,
        storedCredential: record.adminCredential as StoredCredential,
        rpId: vc.env.RP_ID,
        rpOrigin: vc.env.RP_ORIGIN,
      });
      if (!verifyResult.ok) {
        throw new StateTransitionError('ASSERTION_INVALID', verifyResult.error);
      }
      verifiedWebAuthnSignCount = verifyResult.newSignCount;
    }

    if (intent.op === 'update') {
      updateDeliveryProof = buildUpdateDeliveryProof(intent, params);
    }

    if (intent.op === 'delete') {
      new SecretVaultStateMachine(record).commitDelete();
      await finalizeTerminalState(vc, record.uuid, 'deleted', asUnixMs(now));
      // Broadcast channel_closed to all connected clients
      broadcastToWebSockets(vc.ctx, { type: 'channel_closed', reason: 'deleted' });
      closeAllWebSockets(vc.ctx, 'deleted');
      return;
    }

    if (intent.expireAt !== null && intent.expireAt <= now) {
      throw new StateTransitionError(
        'TIMESTAMP_OUT_OF_RANGE',
        'expireAt must be a future timestamp'
      );
    }

    const deliveryExpiresAt =
      intent.expireAt !== null ? intent.expireAt : asUnixMs(record.createdAt + record.ttl);

    const nextRecord = new SecretVaultStateMachine(record).commitDelivery({
      cipherBundle: intent.cipherBundle,
      ...(updateDeliveryProof ? { updateDeliveryProof } : {}),
      deliveredAt: intent.timestamp,
      expiresAt: deliveryExpiresAt,
    });
    const nonceExpiresAt = asUnixMs(now + NONCE_TTL_MS);
    const nonceRecord: NonceRecord = {
      nonce: intent.nonce,
      usedAt: asUnixMs(now),
      expiresAt: nonceExpiresAt,
    };
    await vc.ctx.storage.put(nonceKey, nonceRecord);
    await vc.ctx.storage.put(nonceIndexStorageKey(nonceExpiresAt, intent.nonce), {
      nonce: intent.nonce,
      expiresAt: nonceExpiresAt,
    });

    await vc.ctx.storage.put(COMPOUND_CHALLENGE_KEY, {
      ...challenge,
      consumedAt: asUnixMs(now),
    });

    const updatedRecord: ChannelRecord =
      verifiedWebAuthnSignCount === null
        ? nextRecord
        : {
            ...nextRecord,
            adminCredential: {
              ...(nextRecord.adminCredential as StoredCredential),
              signCount: verifiedWebAuthnSignCount,
            },
          };

    await saveRecord(vc, updatedRecord);
    await scheduleNextAlarm(vc, now);

    // Broadcast DELIVERED state to connected clients (e.g., receiver's SharePage)
    broadcastToWebSockets(vc.ctx, buildStateChangedMessage(updatedRecord));
  });

  return context.commitToken !== undefined
    ? { commitCookieSignal: { action: 'clear', kind: 'compound' } as const }
    : {};
}
