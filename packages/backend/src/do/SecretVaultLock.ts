import {
  type Base64Url,
  CHALLENGE_BYTES,
  CHALLENGE_TTL_MS,
  DOMAIN,
  type LockChallenge,
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
  sha256Hex,
  toUtf8Bytes,
} from '../crypto/bytes.ts';
import {
  buildCommitCookieSignal,
  shouldClearCommitCookie,
  validateCommitToken,
  withCommitCookieSignalError,
} from './SecretVaultCookies.ts';
import { assertUuidMatch, assertWaitingState } from './SecretVaultHttp.ts';
import { buildRateLimitSubject, enforceRateLimit } from './SecretVaultRateLimit.ts';
import { SecretVaultStateMachine } from './SecretVaultStateMachine.ts';
import { loadActiveRecord, saveRecord, scheduleNextAlarm } from './SecretVaultStorage.ts';
import {
  type CommitLockChallengeParams,
  LOCK_CHALLENGE_ID_BYTES,
  LOCK_CHALLENGE_KEY,
  StateTransitionError,
  type StoredLockChallenge,
  type VaultContext,
} from './SecretVaultTypes.ts';
import { broadcastToWebSockets, buildStateChangedMessage } from './SecretVaultWebSocket.ts';

const LEGACY_LOCK_CHALLENGE_KEY_PREFIX = 'lock_challenge:' as const;

interface BeginRequestContext {
  callerKey: Base64Url | undefined;
}

interface CommitRequestContext extends BeginRequestContext {
  commitToken: string | undefined;
}

type LockChallengeStorageLocation = 'fixed' | 'legacy';

interface ResolvedLockChallenge {
  challenge: StoredLockChallenge;
  location: LockChallengeStorageLocation;
}

// ---------------------------------------------------------------------------
// Lock challenge storage helpers (module-internal)
// ---------------------------------------------------------------------------

async function loadLockChallenge(vc: VaultContext): Promise<StoredLockChallenge | undefined> {
  return vc.ctx.storage.get<StoredLockChallenge>(LOCK_CHALLENGE_KEY);
}

async function saveLockChallenge(vc: VaultContext, challenge: StoredLockChallenge): Promise<void> {
  await vc.ctx.storage.put(LOCK_CHALLENGE_KEY, challenge);
}

async function deleteLockChallenge(vc: VaultContext): Promise<void> {
  await vc.ctx.storage.delete(LOCK_CHALLENGE_KEY);
}

function getLegacyLockChallengeStorageKey(id: Base64Url): string {
  return `${LEGACY_LOCK_CHALLENGE_KEY_PREFIX}${id}`;
}

async function resolveLockChallenge(
  vc: VaultContext,
  id: Base64Url
): Promise<ResolvedLockChallenge | undefined> {
  const fixedChallenge = await loadLockChallenge(vc);
  if (fixedChallenge && fixedChallenge.id === id) {
    return { challenge: fixedChallenge, location: 'fixed' };
  }

  const legacyChallenge = await vc.ctx.storage.get<StoredLockChallenge>(
    getLegacyLockChallengeStorageKey(id)
  );
  if (!legacyChallenge) {
    return undefined;
  }

  return { challenge: legacyChallenge, location: 'legacy' };
}

async function saveResolvedLockChallenge(
  vc: VaultContext,
  { challenge, location }: ResolvedLockChallenge
): Promise<void> {
  if (location === 'fixed') {
    await saveLockChallenge(vc, challenge);
    return;
  }
  await vc.ctx.storage.put(getLegacyLockChallengeStorageKey(challenge.id), challenge);
}

async function deleteResolvedLockChallenge(
  vc: VaultContext,
  { challenge, location }: ResolvedLockChallenge
): Promise<void> {
  if (location === 'fixed') {
    await deleteLockChallenge(vc);
    return;
  }
  await vc.ctx.storage.delete(getLegacyLockChallengeStorageKey(challenge.id));
}

// ---------------------------------------------------------------------------
// Public module-level functions
// ---------------------------------------------------------------------------

export async function beginLockChallengeInternal(
  vc: VaultContext,
  uuid: string,
  now: number = Date.now(),
  context: BeginRequestContext = { callerKey: undefined }
): Promise<{
  lockChallenge: LockChallenge;
  commitCookieSignal?: CommitCookieSignal;
}> {
  return vc.ctx.blockConcurrencyWhile(async () => {
    const record = await loadActiveRecord(vc, now);
    assertWaitingState(record);
    assertUuidMatch(record.uuid, uuid);

    const existingChallenge = await loadLockChallenge(vc);
    const activeChallenge =
      existingChallenge &&
      existingChallenge.consumedAt === undefined &&
      existingChallenge.expiresAt > now
        ? existingChallenge
        : null;

    if (activeChallenge) {
      const commitCookieSignal = await buildCommitCookieSignal(
        vc,
        'lock',
        record.uuid,
        activeChallenge,
        context.callerKey
      );

      return {
        lockChallenge: {
          id: activeChallenge.id,
          challenge: activeChallenge.challenge,
          expiresAt: activeChallenge.expiresAt,
        },
        ...(commitCookieSignal ? { commitCookieSignal } : {}),
      };
    }

    enforceRateLimit(
      vc,
      'lock_begin',
      now,
      buildRateLimitSubject({
        scope: 'public',
        callerKey: context.callerKey,
      })
    );

    const cryptoApi = getCryptoApi();
    const id = encodeBase64Url(cryptoApi.getRandomValues(new Uint8Array(LOCK_CHALLENGE_ID_BYTES)));
    const challenge = encodeBase64Url(cryptoApi.getRandomValues(new Uint8Array(CHALLENGE_BYTES)));
    const issuedAt = asUnixMs(now);
    const expiresAt = asUnixMs(now + CHALLENGE_TTL_MS);
    const stored: StoredLockChallenge = context.callerKey
      ? {
          id,
          challenge,
          issuedAt,
          expiresAt,
          commitTokenMode: COMMIT_TOKEN_MODE,
        }
      : { id, challenge, expiresAt };

    await saveLockChallenge(vc, stored);
    const commitCookieSignal = await buildCommitCookieSignal(
      vc,
      'lock',
      record.uuid,
      stored,
      context.callerKey
    );

    return {
      lockChallenge: {
        id: stored.id,
        challenge: stored.challenge,
        expiresAt: stored.expiresAt,
      },
      ...(commitCookieSignal ? { commitCookieSignal } : {}),
    };
  });
}

export async function commitLockChallengeInternal(
  vc: VaultContext,
  {
    uuid,
    lockChallengeId,
    lockProof,
    receiverPubJwk,
    receiverPubFpr,
    lockedAt,
  }: CommitLockChallengeParams,
  now: number = Date.now(),
  context: CommitRequestContext = { callerKey: undefined, commitToken: undefined }
): Promise<{ commitCookieSignal?: CommitCookieSignal }> {
  await vc.ctx.blockConcurrencyWhile(async () => {
    const record = await loadActiveRecord(vc, now);
    assertWaitingState(record);
    assertUuidMatch(record.uuid, uuid);

    const resolvedChallenge = await resolveLockChallenge(vc, lockChallengeId);
    if (!resolvedChallenge) {
      throw withCommitCookieSignalError(
        'lock',
        'CHALLENGE_INVALID',
        'lock challenge not found',
        context.commitToken ? { action: 'clear', kind: 'lock' } : undefined
      );
    }

    const { challenge, location } = resolvedChallenge;
    if (challenge.expiresAt <= now) {
      await deleteResolvedLockChallenge(vc, resolvedChallenge);
      throw withCommitCookieSignalError(
        'lock',
        'CHALLENGE_INVALID',
        'lock challenge expired',
        shouldClearCommitCookie(challenge, context.commitToken)
          ? { action: 'clear', kind: 'lock' }
          : undefined
      );
    }
    if (challenge.consumedAt !== undefined) {
      throw withCommitCookieSignalError(
        'lock',
        'CHALLENGE_CONSUMED',
        'lock challenge already consumed',
        shouldClearCommitCookie(challenge, context.commitToken)
          ? { action: 'clear', kind: 'lock' }
          : undefined
      );
    }

    const tokenHash = await validateCommitToken(vc, {
      kind: 'lock' as CommitCookieKind,
      uuid: record.uuid,
      challenge,
      now,
      callerKey: context.callerKey,
      commitToken: context.commitToken,
    });

    enforceRateLimit(
      vc,
      'lock_commit',
      now,
      buildRateLimitSubject({
        scope: 'authorized',
        callerKey: context.callerKey,
        sessionKey: tokenHash === 'shared' ? undefined : tokenHash,
      })
    );

    const expectedProof = await sha256Hex([
      toUtf8Bytes(DOMAIN.LOCK_PROOF),
      toUtf8Bytes(record.uuid),
      decodeBase64Url(challenge.id),
      decodeBase64Url(challenge.challenge),
      decodeBase64Url(record.lockKey),
    ]);
    if (!constantTimeEqual(expectedProof, lockProof)) {
      throw new StateTransitionError('LOCK_FORBIDDEN', 'lock proof mismatch');
    }

    // M-1: Validate receiverPubFpr matches SHA256(SPKI(receiverPubJwk))
    const cryptoApiLock = getCryptoApi();
    let importedReceiverKey: CryptoKey;
    try {
      importedReceiverKey = await cryptoApiLock.subtle.importKey(
        'jwk',
        receiverPubJwk as unknown as JsonWebKey,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt']
      );
    } catch {
      throw new StateTransitionError('LOCK_FORBIDDEN', 'invalid receiver public key JWK');
    }
    const spkiBytes = new Uint8Array(
      await cryptoApiLock.subtle.exportKey('spki', importedReceiverKey)
    );
    const computedFpr = await sha256Hex([spkiBytes]);
    if (computedFpr !== receiverPubFpr) {
      throw new StateTransitionError(
        'LOCK_FORBIDDEN',
        'receiverPubFpr does not match SHA256(SPKI(receiverPubJwk))'
      );
    }

    await saveResolvedLockChallenge(vc, {
      location,
      challenge: {
        ...challenge,
        consumedAt: asUnixMs(now),
      },
    });
    const nextRecord = new SecretVaultStateMachine(record).commitLock({
      receiverPubJwk,
      receiverPubFpr,
      lockedAt,
    });
    await saveRecord(vc, nextRecord);
    await scheduleNextAlarm(vc, now);

    // Broadcast LOCKED state to connected clients (e.g., sender's ManagePage)
    broadcastToWebSockets(vc.ctx, buildStateChangedMessage(nextRecord));
  });

  return context.commitToken !== undefined
    ? { commitCookieSignal: { action: 'clear', kind: 'lock' } as const }
    : {};
}
