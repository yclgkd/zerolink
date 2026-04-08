import type { TFunction } from 'i18next';
import {
  getPassphraseValidationI18n,
  MIN_PASSPHRASE_LENGTH,
  validatePassphrase,
} from '../../crypto/passphrase-policy';

export function mapDecryptError(code: string, message?: string): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'This channel is no longer available.';
    case 'PASSPHRASE_REQUIRED':
      return message ?? 'Passphrase is required to decrypt.';
    case 'CHANNEL_NOT_DELIVERED':
      return 'Channel is not delivered yet. Ask sender to deliver first.';
    case 'KEY_STORAGE_ERROR':
      return 'Local key material is unavailable on this device.';
    case 'INTEGRITY_MISMATCH':
      return 'Ciphertext integrity verification failed.';
    case 'CRYPTO_ERROR':
      return 'Unable to decrypt with the provided passphrase.';
    case 'NETWORK_ERROR':
    case 'BAD_REQUEST':
    case 'INVALID_REQUEST':
      return 'Decrypt request failed due to network or request validation.';
    case 'INTERNAL_ERROR':
      return 'An unexpected error occurred. Please try again.';
    default:
      return 'Decrypt failed. Please try again.';
  }
}

export function isDecryptPassphraseErrorCode(code: string): boolean {
  return code === 'PASSPHRASE_REQUIRED' || code === 'CRYPTO_ERROR';
}

export function getDecryptPassphraseHelperText(
  passphrase: string,
  t: TFunction
): string | undefined {
  const result = validatePassphrase(passphrase);
  if (result === null) return undefined;
  if (result === 'missing' || result === 'too_short') {
    return t('share.decryptMinLengthHint', { min: MIN_PASSPHRASE_LENGTH });
  }

  const i18n = getPassphraseValidationI18n(result, t('share.decryptLabel'));
  return t(i18n.key, i18n.params);
}
