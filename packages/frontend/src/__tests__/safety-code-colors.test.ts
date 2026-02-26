import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SAFETY_COLOR_PALETTE,
  resolveSafetyCodeColors,
} from '../components/safety/safety-code-colors';

const fullCellRange = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

describe('resolveSafetyCodeColors', () => {
  it('returns 16 mapped colors for a valid 16-cell input', () => {
    const colors = resolveSafetyCodeColors(fullCellRange);

    expect(colors).toHaveLength(16);
    expect(colors[0]).toBe(DEFAULT_SAFETY_COLOR_PALETTE[0]);
    expect(colors[15]).toBe(DEFAULT_SAFETY_COLOR_PALETTE[15]);
  });

  it('uses default palette when custom palette is not provided', () => {
    const colors = resolveSafetyCodeColors(fullCellRange);

    expect(colors).toEqual(DEFAULT_SAFETY_COLOR_PALETTE);
  });

  it('falls back safely when custom palette is incomplete or invalid', () => {
    const colors = resolveSafetyCodeColors(fullCellRange, ['#111111', '', '#333333'] as const);

    expect(colors[0]).toBe('#111111');
    expect(colors[1]).toBe(DEFAULT_SAFETY_COLOR_PALETTE[1]);
    expect(colors[2]).toBe('#333333');
    expect(colors[15]).toBe(DEFAULT_SAFETY_COLOR_PALETTE[15]);
  });
});
