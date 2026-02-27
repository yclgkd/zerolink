import { describe, expect, it } from 'vitest';

import { generateChannelUuid } from '../lib/channel-uuid';

describe('generateChannelUuid', () => {
  it('returns a 21-character uuid', () => {
    const value = generateChannelUuid();
    expect(value).toHaveLength(21);
  });

  it('uses base64url alphabet only', () => {
    const value = generateChannelUuid();
    expect(value).toMatch(/^[A-Za-z0-9_-]{21}$/u);
  });
});
