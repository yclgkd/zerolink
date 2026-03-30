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

  it('returns strong for a four-word passphrase', () => {
    expect(getPassphraseStrength('correct horse battery staple')).toEqual({
      label: 'Strong',
      level: 3,
    });
  });

  it('returns strong for a longer multi-word passphrase', () => {
    expect(getPassphraseStrength('correct horse battery staple winter lantern')).toEqual({
      label: 'Strong',
      level: 3,
    });
  });

  it('returns strong for a long mixed-character password', () => {
    expect(getPassphraseStrength('A8$fK2!mQ9@tZ1#x')).toEqual({
      label: 'Strong',
      level: 3,
    });
  });

  it('keeps common mixed-case passwords at medium', () => {
    expect(getPassphraseStrength('Password123!')).toEqual({
      label: 'Medium',
      level: 2,
    });
  });

  it('downgrades common weak patterns even when they include symbols', () => {
    expect(getPassphraseStrength('password123!')).toEqual({
      label: 'Weak',
      level: 1,
    });
  });

  it('downgrades repeated characters', () => {
    expect(getPassphraseStrength('aaaaaaaaaaaa!!!!')).toEqual({
      label: 'Weak',
      level: 1,
    });
  });

  it('downgrades repeated words', () => {
    expect(getPassphraseStrength('hello hello hello hello')).toEqual({
      label: 'Weak',
      level: 1,
    });
  });
});
