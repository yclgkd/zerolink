import type {
  Base64Url,
  ChannelState,
  CipherBundle,
  HexString,
  RSAPublicKeyJWK,
  SecurityProfile,
  UnixMs,
  UUID,
  WrappedPrivateKey,
} from '@zerolink/shared';
import { AES_GCM, SECURITY_PROFILE } from '@zerolink/shared';
import type { Argon2idKdfParams } from '@zerolink/shared/crypto/kdf';
import type { ApiClient } from '../api/client';
import type {
  CryptoOrchestratorErrorCode,
  CryptoOrchestratorResult,
  DecryptStore,
  DecryptStoreStateSnapshot,
  DeliverStore,
  DeliverStoreStateSnapshot,
} from './orchestrator-types';
import { getPassphraseLengthMessage, validatePassphrase } from './passphrase-policy';
import { computeSha256Hex, decodeBase64UrlBytes, encodeBase64UrlBytes } from './protocol-utils';
import { softkeySign, unwrapSoftkeyPrivateKey } from './softkey';
import type { WebAuthnAdapterErrorCode } from './webauthn';

// Re-export for use by flow modules that need it.
export { decodeBase64UrlBytes };

export function toError(
  code: CryptoOrchestratorErrorCode | string,
  stage: string,
  message?: string
) {
  return {
    ok: false as const,
    error: {
      ok: false as const,
      code,
      stage,
      ...(message ? { message } : {}),
    },
  };
}

export function mapWebAuthnError(
  code: WebAuthnAdapterErrorCode,
  stage: string
): CryptoOrchestratorResult<never> {
  if (code === 'FALLBACK_REQUIRED' || code === 'PROFILE_BLOCKED') {
    return toError(code, stage);
  }
  return toError('WEBAUTHN_ERROR', stage, code);
}

export function ensurePassphrase(
  passphrase: string,
  stage: string
): CryptoOrchestratorResult<never> | null {
  const validationResult = validatePassphrase(passphrase);
  if (validationResult === 'missing') {
    return toError('PASSPHRASE_REQUIRED', stage);
  }
  if (validationResult === 'too_short') {
    return toError('PASSPHRASE_REQUIRED', stage, getPassphraseLengthMessage());
  }
  return null;
}

export function toUtf8Bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export function asUuid(value: string): UUID {
  return value as UUID;
}

export function asUnixMs(value: number): UnixMs {
  return value as UnixMs;
}

export function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function computeReceiverPubFingerprint(publicKey: CryptoKey): Promise<HexString> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
  return (await computeSha256Hex(spki)) as HexString;
}

export function resolveRpOrigin(): string {
  return globalThis.location.origin;
}

export function resolveRpId(): string {
  return globalThis.location.hostname;
}

export const LOCK_SECRET_PATTERN = /^[A-Za-z0-9_-]+$/u;

export function parseLockSecret(lockSecretB64u: string): CryptoOrchestratorResult<never> | null {
  if (!LOCK_SECRET_PATTERN.test(lockSecretB64u)) {
    return toError('INVALID_LOCK_SECRET', 'lock.validate');
  }
  return null;
}

export function toCipherBundleTransport(input: {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  aad: Uint8Array;
  encContentKey: Uint8Array;
  ciphertextHash: string;
  padBlock: number;
}): CipherBundle {
  return {
    ciphertext: encodeBase64UrlBytes(input.ciphertext),
    iv: encodeBase64UrlBytes(input.iv),
    aad: encodeBase64UrlBytes(input.aad),
    encContentKey: encodeBase64UrlBytes(input.encContentKey),
    ciphertextHash: input.ciphertextHash as HexString,
    padBlock: input.padBlock,
  };
}

export function resolvePadBlockForProfile(profile: SecurityProfile): number {
  switch (profile) {
    case SECURITY_PROFILE.SECURE:
    case SECURITY_PROFILE.STRICT:
    case SECURITY_PROFILE.HARDWARE_ONLY:
      return AES_GCM.PAD_BLOCK_STRICT;
    case SECURITY_PROFILE.QUICK:
    case SECURITY_PROFILE.STANDARD:
      return AES_GCM.PAD_BLOCK_DEFAULT;
  }
}

export function randomBase64Url(
  length: number,
  randomBytes: (length: number) => Uint8Array
): Base64Url {
  return encodeBase64UrlBytes(randomBytes(length));
}

export function toPlaintextBytes(value: string | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    return toUtf8Bytes(value);
  }
  return Uint8Array.from(value);
}

export function isDeliveredState(state: ChannelState): boolean {
  return state === 'delivered';
}

export function toStorageErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'KEY_STORAGE_ERROR';
}

export function toApiReceiverPubJwk(
  jwk: RSAPublicKeyJWK
): Parameters<ApiClient['lockCommit']>[0]['receiverPubJwk'] {
  return {
    ...jwk,
    key_ops: ['encrypt'],
  };
}

export function applyDeliverStoreUpdate(
  deliverStore: DeliverStore,
  uuid: string,
  apply: (state: DeliverStoreStateSnapshot) => void
): void {
  const state = deliverStore.getState();
  if (state.uuid !== null && state.uuid !== uuid) return;
  apply(state);
}

export function applyDecryptStoreUpdate(
  decryptStore: DecryptStore,
  uuid: string,
  apply: (state: DecryptStoreStateSnapshot) => void
): void {
  const state = decryptStore.getState();
  if (state.uuid !== null && state.uuid !== uuid) return;
  apply(state);
}

/**
 * Unwraps the sender's ECDSA private key directly from the provided
 * WrappedPrivateKey (sourced from the manage URL fragment) and signs
 * the challenge. No IndexedDB access required.
 */
export async function signChallengeWithWrappedKey(
  wrappedPrivateKey: WrappedPrivateKey,
  passphrase: string,
  expectedChallengeB64u: Base64Url,
  kdfParams?: Argon2idKdfParams
): Promise<HexString> {
  const privateKey = await unwrapSoftkeyPrivateKey(wrappedPrivateKey, passphrase, kdfParams);
  return softkeySign(privateKey, decodeBase64UrlBytes(expectedChallengeB64u));
}
