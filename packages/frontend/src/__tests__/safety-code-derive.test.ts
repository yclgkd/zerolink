import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SAFETY_EMOJI_PALETTE,
  deriveSafetyCodeDisplay,
} from '../crypto/safety-code-derive';

const VALID_FPR = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('safety-code-derive', () => {
  it('derives stable safety-code display from full receiver fingerprint', () => {
    const display = deriveSafetyCodeDisplay(VALID_FPR);

    expect(display.emoji.type).toBe('emoji');
    expect(display.emoji.emojis).toHaveLength(8);
    expect(display.color.type).toBe('color');
    expect(display.color.cells).toHaveLength(16);
    expect(display.shortFpr).toBe('0123456789ab...456789abcdef');
    expect(display.fullFpr).toBe(VALID_FPR);
  });

  it('maps emoji output through the 16-item nibble palette', () => {
    const display = deriveSafetyCodeDisplay(VALID_FPR);

    expect(display.emoji.emojis[0]).toBe(DEFAULT_SAFETY_EMOJI_PALETTE[1]);
    expect(display.emoji.emojis[1]).toBe(DEFAULT_SAFETY_EMOJI_PALETTE[3]);
    expect(display.emoji.emojis[2]).toBe(DEFAULT_SAFETY_EMOJI_PALETTE[5]);
    expect(display.emoji.emojis[3]).toBe(DEFAULT_SAFETY_EMOJI_PALETTE[7]);
  });

  it('maps first sixteen fingerprint nibbles to color cells', () => {
    const display = deriveSafetyCodeDisplay(VALID_FPR);
    expect(display.color.cells).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('throws for invalid receiver fingerprint input', () => {
    expect(() => deriveSafetyCodeDisplay('short')).toThrow(
      'receiverPubFpr must be 64 lowercase hex characters'
    );
    expect(() =>
      deriveSafetyCodeDisplay('0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF')
    ).toThrow('receiverPubFpr must be 64 lowercase hex characters');
  });
});
