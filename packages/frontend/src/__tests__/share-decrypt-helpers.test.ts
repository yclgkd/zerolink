import { describe, expect, it } from 'vitest';

import {
  getDecryptPassphraseHelperText,
  isDecryptPassphraseErrorCode,
  mapDecryptError,
} from '../features/share/share-decrypt-helpers';

const t = ((key: string, params?: Record<string, unknown>) => {
  if (key === 'share.decryptLabel') {
    return 'Decrypt passphrase';
  }
  return `${key}:${JSON.stringify(params ?? {})}`;
}) as never;

describe('mapDecryptError', () => {
  it('maps each supported decrypt error to a stable user message', () => {
    expect(mapDecryptError('NOT_FOUND')).toBe('This channel is no longer available.');
    expect(mapDecryptError('PASSPHRASE_REQUIRED', 'Custom message')).toBe('Custom message');
    expect(mapDecryptError('PASSPHRASE_REQUIRED')).toBe('Passphrase is required to decrypt.');
    expect(mapDecryptError('CHANNEL_NOT_DELIVERED')).toBe(
      'Channel is not delivered yet. Ask sender to deliver first.'
    );
    expect(mapDecryptError('KEY_STORAGE_ERROR')).toBe(
      'Local key material is unavailable on this device.'
    );
    expect(mapDecryptError('INTEGRITY_MISMATCH')).toBe('Ciphertext integrity verification failed.');
    expect(mapDecryptError('CRYPTO_ERROR')).toBe('Unable to decrypt with the provided passphrase.');
    expect(mapDecryptError('NETWORK_ERROR')).toBe(
      'Decrypt request failed due to network or request validation.'
    );
    expect(mapDecryptError('BAD_REQUEST')).toBe(
      'Decrypt request failed due to network or request validation.'
    );
    expect(mapDecryptError('INVALID_REQUEST')).toBe(
      'Decrypt request failed due to network or request validation.'
    );
    expect(mapDecryptError('INTERNAL_ERROR')).toBe(
      'An unexpected error occurred. Please try again.'
    );
    expect(mapDecryptError('UNKNOWN_CODE')).toBe('Decrypt failed. Please try again.');
  });
});

describe('isDecryptPassphraseErrorCode', () => {
  it('flags only passphrase-related decrypt failures', () => {
    expect(isDecryptPassphraseErrorCode('PASSPHRASE_REQUIRED')).toBe(true);
    expect(isDecryptPassphraseErrorCode('CRYPTO_ERROR')).toBe(true);
    expect(isDecryptPassphraseErrorCode('NOT_FOUND')).toBe(false);
  });
});

describe('getDecryptPassphraseHelperText', () => {
  it('returns undefined for valid passphrases', () => {
    expect(getDecryptPassphraseHelperText('correct horse battery staple', t)).toBeUndefined();
  });

  it('returns the min-length hint for missing and too-short passphrases', () => {
    expect(getDecryptPassphraseHelperText('', t)).toBe('share.decryptMinLengthHint:{"min":12}');
    expect(getDecryptPassphraseHelperText('short', t)).toBe(
      'share.decryptMinLengthHint:{"min":12}'
    );
  });

  it('returns translated validation errors for invalid whitespace and too-long values', () => {
    expect(getDecryptPassphraseHelperText('correct horse\tbattery staple', t)).toBe(
      'passphrase.errorInvalidWhitespace:{"label":"Decrypt passphrase","min":12,"max":128}'
    );
    expect(getDecryptPassphraseHelperText('a'.repeat(129), t)).toBe(
      'passphrase.errorTooLong:{"label":"Decrypt passphrase","min":12,"max":128}'
    );
  });
});
