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

  it('returns medium for a four-word passphrase', () => {
    expect(getPassphraseStrength('correct horse battery staple')).toEqual({
      label: 'Medium',
      level: 2,
    });
  });

  it('returns strong for a longer multi-word passphrase', () => {
    expect(getPassphraseStrength('correct horse battery staple winter lantern')).toEqual({
      label: 'Strong',
      level: 3,
    });
  });
});
