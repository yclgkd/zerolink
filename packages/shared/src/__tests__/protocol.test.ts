import { describe, expect, it } from 'vitest';

import { buildCipherBundleAadBytes, buildCipherBundleAadString } from '../protocol.ts';

describe('cipher bundle AAD helpers', () => {
  it('builds the documented uuid||version||receiverPubFpr string', () => {
    expect(
      buildCipherBundleAadString({
        uuid: 'aaaaaaaaaaaaaaaaaaaaa',
        version: 7,
        receiverPubFpr: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      })
    ).toBe(
      'aaaaaaaaaaaaaaaaaaaaa||7||0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    );
  });

  it('encodes the canonical string as UTF-8 bytes', () => {
    const bytes = buildCipherBundleAadBytes({
      uuid: 'bbbbbbbbbbbbbbbbbbbbb',
      version: 0,
      receiverPubFpr: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    });

    expect(new TextDecoder().decode(bytes)).toBe(
      'bbbbbbbbbbbbbbbbbbbbb||0||fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
    );
  });
});
