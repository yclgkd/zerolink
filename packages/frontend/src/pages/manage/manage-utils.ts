import type { ChannelState } from '@zerolink/shared';
import { CHANNEL_STATE } from '@zerolink/shared';
import i18next from 'i18next';

import {
  getPassphraseValidationI18n,
  type PassphraseValidationI18n,
  validatePassphrase,
} from '../../crypto/passphrase-policy';

export function mapActionError(code: string, message?: string): string {
  if (code === 'PASSPHRASE_REQUIRED') {
    if (message) return message;
    const i18n = getPassphraseValidationI18n('too_short', i18next.t('manage.softkeyLabel'));
    return i18next.t(i18n.key, i18n.params);
  }

  const keyMap: Record<string, string> = {
    NOT_FOUND: 'manageError.notFound',
    FALLBACK_REQUIRED: 'manageError.fallbackRequired',
    PROFILE_BLOCKED: 'manageError.profileBlocked',
    MISSING_LOCK_CHALLENGE: 'manageError.missingLockChallenge',
    MISSING_RECEIVER_IDENTITY: 'manageError.missingReceiverIdentity',
    NETWORK_ERROR: 'manageError.networkError',
    BAD_REQUEST: 'manageError.badRequest',
    INVALID_REQUEST: 'manageError.badRequest',
    WEBAUTHN_ERROR: 'manageError.webauthnError',
    NOT_ALLOWED: 'manageError.webauthnError',
    ABORTED: 'manageError.webauthnError',
    CRYPTO_ERROR: 'manageError.cryptoError',
    INTERNAL_ERROR: 'manageError.internalError',
  };

  return i18next.t(keyMap[code] ?? 'manageError.default');
}

export function requiresChannelPassword(adminMode: string | null): boolean {
  return adminMode === 'password' || adminMode === 'softkey';
}

export function getChannelPasswordValidationErrorI18n(
  passphrase: string,
  label: string
): PassphraseValidationI18n | null {
  const result = validatePassphrase(passphrase);
  return result === null ? null : getPassphraseValidationI18n(result, label);
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
