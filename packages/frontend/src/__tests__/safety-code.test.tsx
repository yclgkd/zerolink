// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { HexString, SafetyCodeDisplay } from '@zerolink/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { SafetyCode } from '../components/safety/safety-code';
import { DEFAULT_SAFETY_COLOR_PALETTE } from '../components/safety/safety-code-colors';

const display: SafetyCodeDisplay = {
  emoji: {
    type: 'emoji',
    emojis: ['🔥', '🌲', '🚀', '🔮', '💎', '🎯', '⚡', '🌙'],
  },
  color: {
    type: 'color',
    cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
  shortFpr: 'a1b2c3d4e5f6...f1e2d3c4b5a6',
  fullFpr: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00' as HexString,
};

function hexToRgb(hex: string): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

describe('SafetyCode', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title and default verify hint', () => {
    render(<SafetyCode display={display} />);

    expect(screen.getByText('Safety Code')).toBeTruthy();
    expect(
      screen.getByText('Verify this code via another channel (phone, video call)')
    ).toBeTruthy();
  });

  it('uses color view by default and renders exactly 16 color cells', () => {
    render(<SafetyCode display={display} />);

    expect(screen.getByRole('button', { name: 'Colors' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getAllByTestId(/safety-code-color-cell-/)).toHaveLength(16);
  });

  it('switches to color view and renders 16 color cells', () => {
    render(<SafetyCode display={display} />);

    fireEvent.click(screen.getByRole('button', { name: 'Colors' }));
    expect(screen.getByRole('button', { name: 'Colors' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getAllByTestId(/safety-code-color-cell-/)).toHaveLength(16);
  });

  it('applies mapped palette values to color cells', () => {
    render(<SafetyCode display={display} />);

    fireEvent.click(screen.getByRole('button', { name: 'Colors' }));
    const firstCell = screen.getByTestId('safety-code-color-cell-0');
    const sixteenthCell = screen.getByTestId('safety-code-color-cell-15');

    expect((firstCell as HTMLDivElement).style.backgroundColor).toBe(
      hexToRgb(DEFAULT_SAFETY_COLOR_PALETTE[0])
    );
    expect((sixteenthCell as HTMLDivElement).style.backgroundColor).toBe(
      hexToRgb(DEFAULT_SAFETY_COLOR_PALETTE[15])
    );
  });

  it('renders color view initially when defaultView is color', () => {
    render(<SafetyCode defaultView="color" display={display} />);

    expect(screen.getByRole('button', { name: 'Colors' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getAllByTestId(/safety-code-color-cell-/)).toHaveLength(16);
  });

  it('keeps advanced section collapsed by default', () => {
    render(<SafetyCode display={display} />);

    const toggle = screen.getByRole('button', { name: 'Advanced fingerprint' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('safety-code-advanced-content')).toBeNull();
  });

  it('shows short and full fingerprint when advanced section is expanded', () => {
    render(<SafetyCode display={display} />);

    const toggle = screen.getByRole('button', { name: 'Advanced fingerprint' });
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('safety-code-advanced-content')).toBeTruthy();
    expect(screen.getByText(display.shortFpr)).toBeTruthy();
    expect(screen.getByText(display.fullFpr)).toBeTruthy();
  });

  it('collapses advanced section when toggled again', () => {
    render(<SafetyCode display={display} />);

    const toggle = screen.getByRole('button', { name: 'Advanced fingerprint' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('safety-code-advanced-content')).toBeNull();
  });

  it('merges className without dropping base classes', () => {
    render(<SafetyCode className="custom-safety-card" display={display} />);

    const root = screen.getByTestId('safety-code-root');
    expect(root.className).toContain('custom-safety-card');
    expect(root.className).toContain('border-border/70');
  });

  it('renders custom verify hint when provided', () => {
    render(<SafetyCode display={display} verifyHint="Compare over secure voice call." />);

    expect(screen.getByText('Compare over secure voice call.')).toBeTruthy();
  });
});
