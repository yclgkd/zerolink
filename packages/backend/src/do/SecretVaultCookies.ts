import type { Base64Url } from '@zerolink/shared';
import {
  appendInternalCommitCookieSignal,
  COMMIT_TOKEN_MODE,
  type CommitCookieKind,
  type CommitCookieSignal,
  createCommitToken,
  hashCommitToken,
  verifyCommitToken,
} from '../commitTokens.ts';
import {
  CommitCookieStateTransitionError,
  StateTransitionError,
  type StoredCompoundChallenge,
  type StoredLockChallenge,
  type VaultContext,
} from './SecretVaultTypes.ts';

// ---------------------------------------------------------------------------
// Commit cookie signal helpers
// ---------------------------------------------------------------------------

export function withCommitCookieSignal(response: Response, signal?: CommitCookieSignal): Response {
  if (!signal) {
    return response;
  }

  const headers = new Headers(response.headers);
  appendInternalCommitCookieSignal(headers, signal);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withCommitCookieSignalFromError(error: unknown, response: Response): Response {
  if (!(error instanceof CommitCookieStateTransitionError)) {
    return response;
  }

  return withCommitCookieSignal(response, error.commitCookieSignal);
}

export function withCommitCookieSignalError(
  _kind: CommitCookieKind,
  code: StateTransitionError['code'],
  message: string,
  signal?: CommitCookieSignal
): StateTransitionError {
  if (!signal) {
    return new StateTransitionError(code, message);
  }

  return new CommitCookieStateTransitionError(code, message, signal);
}

export function shouldClearCommitCookie(
  challenge: Pick<StoredLockChallenge | StoredCompoundChallenge, 'commitTokenMode'>,
  commitToken?: string
): boolean {
  return challenge.commitTokenMode === COMMIT_TOKEN_MODE && commitToken !== undefined;
}

export async function buildCommitCookieSignal(
  vc: VaultContext,
  kind: CommitCookieKind,
  uuid: string,
  challenge: Pick<
    StoredLockChallenge | StoredCompoundChallenge,
    'id' | 'issuedAt' | 'expiresAt' | 'commitTokenMode'
  >,
  callerKey?: Base64Url
): Promise<CommitCookieSignal | undefined> {
  if (
    challenge.commitTokenMode !== COMMIT_TOKEN_MODE ||
    challenge.issuedAt === undefined ||
    !callerKey
  ) {
    return undefined;
  }

  const token = await createCommitToken(vc.env.COMMIT_TOKEN_SECRET, {
    kind,
    uuid,
    challengeId: challenge.id,
    callerKey,
    iat: challenge.issuedAt,
    exp: challenge.expiresAt,
  });

  return {
    action: 'set',
    kind,
    token,
    exp: challenge.expiresAt,
  };
}

export async function validateCommitToken(
  vc: VaultContext,
  {
    kind,
    uuid,
    challenge,
    now,
    callerKey,
    commitToken,
  }: {
    kind: CommitCookieKind;
    uuid: string;
    challenge: Pick<
      StoredLockChallenge | StoredCompoundChallenge,
      'id' | 'issuedAt' | 'expiresAt' | 'commitTokenMode'
    >;
    now: number;
    callerKey: Base64Url | undefined;
    commitToken: string | undefined;
  }
): Promise<string> {
  if (challenge.commitTokenMode !== COMMIT_TOKEN_MODE) {
    return 'shared';
  }

  if (!callerKey) {
    throw new StateTransitionError('CHALLENGE_INVALID', 'caller key missing');
  }

  if (!commitToken) {
    throw new StateTransitionError('CHALLENGE_INVALID', 'commit token missing');
  }

  const payload = await verifyCommitToken(vc.env.COMMIT_TOKEN_SECRET, commitToken);
  if (!payload) {
    throw new CommitCookieStateTransitionError('CHALLENGE_INVALID', 'commit token invalid', {
      action: 'clear',
      kind,
    });
  }

  if (
    challenge.issuedAt === undefined ||
    payload.kind !== kind ||
    payload.uuid !== uuid ||
    payload.challengeId !== challenge.id ||
    payload.callerKey !== callerKey ||
    payload.iat !== challenge.issuedAt ||
    payload.iat > payload.exp ||
    payload.exp > challenge.expiresAt ||
    payload.exp <= now
  ) {
    throw new CommitCookieStateTransitionError(
      'CHALLENGE_INVALID',
      'commit token does not match active challenge',
      {
        action: 'clear',
        kind,
      }
    );
  }

  return hashCommitToken(commitToken);
}
