import type {
  Base64Url,
  ChannelTtlMs,
  CipherBundle,
  CompoundBeginResponse,
  DecryptedFilePayload,
  DecryptedSharePayload,
  DeleteIntent,
  HexString,
  MultipartFileRef,
  RSAPublicKeyJWK,
  SecurityProfile,
  UpdateIntent,
  WrappedPrivateKey,
} from '@zerolink/shared';
import type { Argon2idKdfParams } from '@zerolink/shared/crypto/kdf';

import type { ApiClient } from '../api/client';
import type { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import type { ReceiverKeyStorage } from './storage';

export type CreateStore = typeof useCreateStore;
export type LockStore = typeof useLockStore;
export type DeliverStore = typeof useDeliverStore;
export type DecryptStore = typeof useDecryptStore;

/**
 * Known error codes returned by the CryptoOrchestrator flows.
 */
export type CryptoOrchestratorErrorCode =
  | 'API_ERROR'
  | 'WEBAUTHN_ERROR'
  | 'FALLBACK_REQUIRED'
  | 'PROFILE_BLOCKED'
  | 'ATTESTATION_UNVERIFIABLE'
  | 'INVALID_LOCK_SECRET'
  | 'MISSING_LOCK_CHALLENGE'
  | 'MISSING_RECEIVER_IDENTITY'
  | 'KEY_STORAGE_ERROR'
  | 'PASSPHRASE_REQUIRED'
  | 'CHANNEL_NOT_DELIVERED'
  | 'INTEGRITY_MISMATCH'
  | 'FILE_TOO_LARGE'
  | 'FILE_STORAGE_UNAVAILABLE'
  | 'MULTIPART_REQUIRED'
  | 'CRYPTO_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Error envelope containing details about where and why a cryptographic flow failed.
 */
export interface CryptoOrchestratorError {
  ok: false;
  code: CryptoOrchestratorErrorCode | string;
  stage: string;
  message?: string;
}

/**
 * Result union representing either success with data or failure with an orchestrator error.
 */
export type CryptoOrchestratorResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: CryptoOrchestratorError;
    };

/**
 * Dependency injection mapping for the CryptoOrchestrator.
 */
export interface CryptoOrchestratorDeps {
  apiClient?: ApiClient;
  receiverKeyStorage?: ReceiverKeyStorage;
  createStore?: CreateStore;
  lockStore?: LockStore;
  deliverStore?: DeliverStore;
  decryptStore?: DecryptStore;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  kdfParams?: Argon2idKdfParams | undefined;
}

/**
 * Input for the createChannel flow.
 */
export interface CreateChannelInput {
  uuid: string;
  profile: SecurityProfile;
  ttl?: ChannelTtlMs;
  lockSecretB64u?: string;
  useCompatibilityMode?: boolean;
  /** Required when useCompatibilityMode is true. Used as Argon2id passphrase to wrap the softkey private key. Must be a user-supplied secret, never the channel UUID. */
  softkeyPassphrase?: string;
}

/**
 * Output of a successful createChannel flow.
 */
export interface CreateChannelOutput {
  shareUrl: string;
  manageUrl: string;
  shareUrlWithFragment: string;
  lockSecretB64u: string;
  lockKeyB64u: string;
  /** Present when channel uses Quick Share (password/softkey) mode. Used to build the manage URL fragment. */
  wrappedPrivateKey?: WrappedPrivateKey;
}

/**
 * Input for the lockChannel flow.
 */
export interface LockChannelInput {
  uuid: string;
  lockSecretB64u: string;
  passphrase: string;
  senderAuthFpr?: HexString;
}

/**
 * Output of a successful lockChannel flow.
 */
export interface LockChannelOutput {
  receiverPubJwk: RSAPublicKeyJWK;
  receiverPubFpr: HexString;
}

/**
 * Input for the deliverSecret flow.
 */
export interface DeliverSecretInput {
  uuid: string;
  profile: SecurityProfile;
  plaintext: string | Uint8Array;
  file?: {
    fileName: string;
    mediaType: string;
    bytes?: Uint8Array;
    blob?: Blob;
    size?: number;
  };
  expireAt?: number | null;
  /** Required when the channel uses softkey/password mode. Must match the passphrase used at create time. */
  softkeyPassphrase?: string;
  /** The sender's wrapped ECDSA private key, sourced from the manage URL fragment. Required for password mode. */
  wrappedPrivateKey?: WrappedPrivateKey;
}

/**
 * Output of a successful deliverSecret flow.
 */
export interface DeliverSecretOutput {
  intentHash: string;
  intent: UpdateIntent;
  expectedChallenge: string;
  cipherBundle?: CipherBundle | undefined;
  fileRef?: MultipartFileRef | undefined;
  payloadKind: DecryptedSharePayload['kind'];
}

/**
 * Input for the deleteChannel flow.
 */
export interface DeleteChannelInput {
  uuid: string;
  profile: SecurityProfile;
  /** Required when the channel uses softkey/password mode. Must match the passphrase used at create time. */
  softkeyPassphrase?: string;
  /** The sender's wrapped ECDSA private key, sourced from the manage URL fragment. Required for password mode. */
  wrappedPrivateKey?: WrappedPrivateKey;
}

/**
 * Output of a successful deleteChannel flow.
 */
export interface DeleteChannelOutput {
  intentHash: string;
  intent: DeleteIntent;
  expectedChallenge: string;
}

/**
 * Input for the decryptDelivered flow.
 */
export interface DecryptDeliveredInput {
  uuid: string;
  passphrase: string;
}

/**
 * Output of a successful decryptDelivered flow.
 */
export interface DecryptDeliveredOutput {
  deliveredAt: number;
  receiverPubFpr: string;
  cipherVersion: number;
  payload: DecryptedSharePayload;
}

/**
 * The high-level orchestrator that drives complex zero-knowledge workflows.
 */
export interface CryptoOrchestrator {
  createChannel: (
    input: CreateChannelInput
  ) => Promise<CryptoOrchestratorResult<CreateChannelOutput>>;
  lockChannel: (input: LockChannelInput) => Promise<CryptoOrchestratorResult<LockChannelOutput>>;
  deliverSecret: (
    input: DeliverSecretInput
  ) => Promise<CryptoOrchestratorResult<DeliverSecretOutput>>;
  deleteChannel: (
    input: DeleteChannelInput
  ) => Promise<CryptoOrchestratorResult<DeleteChannelOutput>>;
  decryptDelivered: (
    input: DecryptDeliveredInput
  ) => Promise<CryptoOrchestratorResult<DecryptDeliveredOutput>>;
}

/**
 * Fully-resolved dependency object used internally by all flow modules.
 */
export interface ResolvedDeps {
  client: ApiClient;
  receiverKeyStorage: ReceiverKeyStorage;
  createStore: CreateStore;
  lockStore: LockStore;
  deliverStore: DeliverStore;
  decryptStore: DecryptStore;
  now: () => number;
  randomBytes: (length: number) => Uint8Array;
  kdfParams?: Argon2idKdfParams | undefined;
}

export type ResolvedDeliverBeginData = CompoundBeginResponse & {
  challenge: NonNullable<CompoundBeginResponse['challenge']>;
  receiverPubJwk: NonNullable<CompoundBeginResponse['receiverPubJwk']>;
  receiverPubFpr: NonNullable<CompoundBeginResponse['receiverPubFpr']>;
};

export type { DecryptedFilePayload };

export type DeliverStoreStateSnapshot = ReturnType<DeliverStore['getState']>;
export type DecryptStoreStateSnapshot = ReturnType<DecryptStore['getState']>;

// Re-export Base64Url for use in flow modules that need to cast
export type { Base64Url };
