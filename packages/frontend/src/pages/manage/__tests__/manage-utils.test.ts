import { describe, expect, it } from 'vitest';
import { mapActionError } from '../manage-utils';

describe('mapActionError', () => {
  it('returns specific message for CRYPTO_ERROR (wrong channel password)', () => {
    expect(mapActionError('CRYPTO_ERROR')).toBe('Incorrect channel password. Please try again.');
  });

  it('returns not-found message for NOT_FOUND', () => {
    expect(mapActionError('NOT_FOUND')).toBe('This channel is no longer available.');
  });

  it('returns generic message for unknown codes', () => {
    expect(mapActionError('UNKNOWN_CODE')).toBe('An unexpected error occurred. Please try again.');
  });
});
