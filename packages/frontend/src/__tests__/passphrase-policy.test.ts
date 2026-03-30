import { describe, expect, it } from 'vitest';

import {
  getPassphraseValidationError,
  hasValidPassphrase,
  normalizePassphrase,
  validatePassphrase,
} from '../crypto/passphrase-policy';

describe('passphrase policy', () => {
  it('trims only ordinary spaces at the edges', () => {
    expect(normalizePassphrase('  correct horse battery staple  ')).toBe(
      'correct horse battery staple'
    );
  });

  it('allows ordinary spaces between words', () => {
    expect(validatePassphrase('correct horse battery staple')).toBeNull();
    expect(hasValidPassphrase('correct horse battery staple')).toBe(true);
  });

  it('rejects passphrases shorter than 12 characters after edge trimming', () => {
    expect(validatePassphrase('  short pass  ')).toBe('too_short');
  });

  it('rejects passphrases longer than 128 characters', () => {
    expect(validatePassphrase('a'.repeat(129))).toBe('too_long');
  });

  it('rejects tabs, line breaks, and special spaces', () => {
    expect(validatePassphrase('correct\thorse battery staple')).toBe('invalid_whitespace');
    expect(validatePassphrase('correct horse\nbattery staple')).toBe('invalid_whitespace');
    expect(validatePassphrase('correct horse\u00A0battery staple')).toBe('invalid_whitespace');
    expect(validatePassphrase('correct horse\u3000battery staple')).toBe('invalid_whitespace');
  });

  it('rejects zero-width and invisible characters', () => {
    expect(validatePassphrase('correct horse\u200Bbattery staple')).toBe('invalid_whitespace');
    expect(validatePassphrase('correct horse\u200Cbattery staple')).toBe('invalid_whitespace');
    expect(validatePassphrase('correct horse\u200Dbattery staple')).toBe('invalid_whitespace');
    expect(validatePassphrase('correct horse\uFEFFbattery staple')).toBe('invalid_whitespace');
  });

  it('returns a specific invalid whitespace message', () => {
    expect(
      getPassphraseValidationError('correct horse\u00A0battery staple', 'Channel password')
    ).toBe(
      'Channel password can use ordinary spaces between words, but not tabs, line breaks, or special spaces'
    );
  });
});
