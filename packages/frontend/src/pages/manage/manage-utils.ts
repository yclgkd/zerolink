import type { ChannelState } from '@zerolink/shared';
import { CHANNEL_STATE } from '@zerolink/shared';
import {
  getPassphraseValidationError as getPassphrasePolicyError,
  getPassphraseValidationMessage,
} from '../../crypto/passphrase-policy';

export function mapActionError(code: string, message?: string): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'This channel is no longer available.';
    case 'FALLBACK_REQUIRED':
      return 'Password-managed channels are unavailable for this action in the current build.';
    case 'PROFILE_BLOCKED':
      return 'Selected security profile requires WebAuthn support.';
    case 'MISSING_LOCK_CHALLENGE':
      return 'Unable to fetch challenge from server. Please retry.';
    case 'MISSING_RECEIVER_IDENTITY':
      return 'Receiver identity is unavailable. Ask receiver to lock again.';
    case 'PASSPHRASE_REQUIRED':
      return message ?? getPassphraseValidationMessage('too_short', 'Channel password');
    case 'NETWORK_ERROR':
      return 'Network error while performing manage action. Please retry.';
    case 'BAD_REQUEST':
    case 'INVALID_REQUEST':
      return 'Manage request was rejected. Please retry.';
    case 'WEBAUTHN_ERROR':
    case 'NOT_ALLOWED':
    case 'ABORTED':
      return 'WebAuthn verification was not completed.';
    case 'CRYPTO_ERROR':
      return 'Incorrect channel password. Please try again.';
    case 'INTERNAL_ERROR':
      return 'Unexpected internal error. Please retry.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}

export function requiresChannelPassword(adminMode: string | null): boolean {
  return adminMode === 'password' || adminMode === 'softkey';
}

export function getChannelPasswordValidationError(passphrase: string): string | null {
  return getPassphrasePolicyError(passphrase, 'Channel password');
}

export function isTerminalPublicState(state: ChannelState): boolean {
  return state === CHANNEL_STATE.DELETED || state === CHANNEL_STATE.EXPIRED;
}

export function canComposeDelivery(status: ChannelState): boolean {
  return status === CHANNEL_STATE.LOCKED || status === CHANNEL_STATE.DELIVERED;
}

export function isTerminalManageState(status: ChannelState, unavailable: boolean): boolean {
  return unavailable || status === CHANNEL_STATE.DELETED || status === CHANNEL_STATE.EXPIRED;
}
