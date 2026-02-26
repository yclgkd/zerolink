import { describe, expect, it } from 'vitest';

import { getPassphraseStrength } from '../components/lock/passphrase-strength';

describe('getPassphraseStrength', () => {
  it('returns level 0 for empty passphrase', () => {
    expect(getPassphraseStrength('')).toEqual({
      label: '',
      level: 0,
    });
  });

  it('returns weak for short and simple passphrase', () => {
    expect(getPassphraseStrength('abc')).toEqual({
      label: 'Weak',
      level: 1,
    });
  });

  it('returns medium for mixed case + digits passphrase', () => {
    expect(getPassphraseStrength('Password12')).toEqual({
      label: 'Medium',
      level: 2,
    });
  });

  it('returns strong for long complex passphrase', () => {
    expect(getPassphraseStrength('Strong#Pass1234XYZ')).toEqual({
      label: 'Strong',
      level: 3,
    });
  });
});
