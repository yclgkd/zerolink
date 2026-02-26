import type { SafetyCodeColor } from '@zerolink/shared';

/**
 * Default 16-color palette used to render 4x4 Safety Code grids.
 */
export const DEFAULT_SAFETY_COLOR_PALETTE = [
  '#a855f7',
  '#ec4899',
  '#f97316',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#3b82f6',
  '#eab308',
  '#84cc16',
  '#f43f5e',
  '#6366f1',
  '#22c55e',
  '#0ea5e9',
] as const;

function isValidColorToken(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getPaletteEntry(index: number, palette?: readonly string[]): string {
  const fallback = DEFAULT_SAFETY_COLOR_PALETTE[index] ?? DEFAULT_SAFETY_COLOR_PALETTE[0];
  const custom = palette?.[index];
  return isValidColorToken(custom) ? custom : fallback;
}

/**
 * Resolves color cell indices into actual color strings with safe fallback behavior.
 * @param cells - The array of color indices from the safety code payload
 * @param palette - Optional custom palette to map indices to colors
 */
export function resolveSafetyCodeColors(
  cells: SafetyCodeColor['cells'],
  palette?: readonly string[]
): string[] {
  return cells.map((cell) => getPaletteEntry(cell, palette));
}
