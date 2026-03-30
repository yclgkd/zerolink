// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { StateNotice } from '../components/layout/state-notice';

describe('StateNotice', () => {
  afterEach(() => {
    cleanup();
  });

  it('defaults to alert + assertive aria-live for error tone', () => {
    render(<StateNotice tone="error">Failure happened</StateNotice>);

    const notice = screen.getByRole('alert');
    expect(notice.getAttribute('aria-live')).toBe('assertive');
  });

  it('defaults to status + polite aria-live for non-error tones', () => {
    const { rerender } = render(<StateNotice tone="warning">Warn</StateNotice>);
    let notice = screen.getByRole('status');
    expect(notice.getAttribute('aria-live')).toBe('polite');

    rerender(<StateNotice tone="info">Info</StateNotice>);
    notice = screen.getByRole('status');
    expect(notice.getAttribute('aria-live')).toBe('polite');

    rerender(<StateNotice tone="success">Success</StateNotice>);
    notice = screen.getByRole('status');
    expect(notice.getAttribute('aria-live')).toBe('polite');
  });

  it('merges custom className with base tone styles', () => {
    render(
      <StateNotice className="custom-notice-class" tone="success">
        Saved
      </StateNotice>
    );

    const notice = screen.getByRole('status');
    expect(notice.className).toContain('custom-notice-class');
    expect(notice.className).toContain('border-neon-green/25');
  });

  it('auto-focuses when autoFocusOnMount is enabled', () => {
    render(
      <StateNotice autoFocusOnMount tone="error">
        Focus target
      </StateNotice>
    );

    const notice = screen.getByRole('alert');
    expect(document.activeElement).toBe(notice);
  });
});
