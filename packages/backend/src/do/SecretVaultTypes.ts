import type {
  AssertionJSON,
  Base64Url,
  CipherBundle,
  HexString,
  ManageIntent,
  RSAPublicKeyJWK,
  UnixMs,
} from '@zerolink/shared';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface SecretVaultEnv {
  SECRET_VAULT: DurableObjectNamespace;
  SECRETS_KV: KVNamespace;
  APP_ENV: string;
  COMMIT_TOKEN_SECRET: string;
  RP_ID: string;
  RP_ORIGIN: string;
}

export interface CommitLockParams {
  receiverPubJwk: RSAPublicKeyJWK;
  receiverPubFpr: HexString;
  lockedAt: UnixMs;
}

export interface CommitDeliveryParams {
  cipherBundle: CipherBundle;
  deliveredAt: UnixMs;
}

export interface CommitLockChallengeParams {
  uuid: string;
  lockChallengeId: Base64Url;
  lockProof: HexString;
  receiverPubJwk: RSAPublicKeyJWK;
  receiverPubFpr: HexString;
  lockedAt: UnixMs;
}

export interface WebAuthnCompoundCommitParams {
  adminMode?: 'webauthn';
  uuid: string;
  assertion: AssertionJSON;
  intentHash: HexString;
  intent: ManageIntent;
}

export interface SoftkeyCompoundCommitParams {
  adminMode: 'password' | 'softkey';
  uuid: string;
  softkeySignature: HexString;
  intentHash: HexString;
  intent: ManageIntent;
}

export type CompoundCommitParams = WebAuthnCompoundCommitParams | SoftkeyCompoundCommitParams;

// ---------------------------------------------------------------------------
// Internal interfaces (exported for use across split files)
// ---------------------------------------------------------------------------

export interface StoredLockChallenge {
  id: Base64Url;
  challenge: Base64Url;
  issuedAt?: UnixMs;
  expiresAt: UnixMs;
  consumedAt?: UnixMs;
  commitTokenMode?: 'caller-cookie-v1';
}

export interface StoredCompoundChallenge {
  id: Base64Url;
  seed: Base64Url;
  issuedAt?: UnixMs;
  expiresAt: UnixMs;
  consumedAt?: UnixMs;
  commitTokenMode?: 'caller-cookie-v1';
}

export interface StoredTerminalTombstone {
  uuid: string;
  reason: 'deleted' | 'expired';
  finalizedAt: UnixMs;
}

export interface NonceIndexRecord {
  nonce: Base64Url;
  expiresAt: UnixMs;
}

export interface LooseAssertionJson {
  id: Base64Url;
  rawId: Base64Url;
  type: 'public-key';
  response: {
    clientDataJSON: Base64Url;
    authenticatorData: Base64Url;
    signature: Base64Url;
    userHandle?: Base64Url | null | undefined;
  };
}

export interface ErrorResponse {
  ok: false;
  code: string;
}

export interface MethodNotAllowedResponse extends ErrorResponse {
  code: 'METHOD_NOT_ALLOWED';
}

// ---------------------------------------------------------------------------
// State transition error
// ---------------------------------------------------------------------------

export type StateTransitionErrorCode =
  | 'INVALID_TRANSITION'
  | 'TERMINAL_STATE'
  | 'RECORD_NOT_FOUND'
  | 'CHALLENGE_INVALID'
  | 'CHALLENGE_CONSUMED'
  | 'LOCK_FORBIDDEN'
  | 'VERSION_MISMATCH'
  | 'NONCE_REPLAY'
  | 'TIMESTAMP_OUT_OF_RANGE'
  | 'ASSERTION_INVALID'
  | 'INTENT_HASH_MISMATCH'
  | 'CIPHER_BUNDLE_INVALID'
  | 'ATTESTATION_UNVERIFIABLE';

export class StateTransitionError extends Error {
  readonly code: StateTransitionErrorCode;

  constructor(code: StateTransitionErrorCode, message: string) {
    super(message);
    this.name = 'StateTransitionError';
    this.code = code;
  }
}

export class RateLimitError extends Error {
  readonly code = 'RATE_LIMITED' as const;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message: string = 'rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

// ---------------------------------------------------------------------------
// Storage key constants
// ---------------------------------------------------------------------------

export const CHANNEL_RECORD_KEY = 'channel_record' as const;
export const CREATION_CHALLENGE_KEY = 'creation_challenge' as const;
export const LOCK_CHALLENGE_KEY = 'lock_challenge_active' as const;
export const COMPOUND_CHALLENGE_KEY = 'compound_challenge_active' as const;
export const TERMINAL_TOMBSTONE_KEY = 'terminal_tombstone' as const;
export const NONCE_KEY_PREFIX = 'nonce:' as const;
export const NONCE_INDEX_KEY_PREFIX = 'nonce_index:' as const;

// Internal challenge ID constants
export const LOCK_CHALLENGE_ID_BYTES = 16;
export const COMPOUND_CHALLENGE_ID_BYTES = 16;

// Internal sweep constants
export const NONCE_INDEX_TIMESTAMP_WIDTH = 16;
export const NONCE_SWEEP_BATCH_SIZE = 128;

export function nonceStorageKey(nonce: Base64Url): string {
  return `${NONCE_KEY_PREFIX}${nonce}`;
}

export function nonceIndexStorageKey(expiresAt: UnixMs, nonce: Base64Url): string {
  const paddedExpiresAt = String(expiresAt).padStart(NONCE_INDEX_TIMESTAMP_WIDTH, '0');
  return `${NONCE_INDEX_KEY_PREFIX}${paddedExpiresAt}:${nonce}`;
}
