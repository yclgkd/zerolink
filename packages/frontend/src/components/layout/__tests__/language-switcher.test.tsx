// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageSwitcher } from '../language-switcher';

describe('LanguageSwitcher', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders trigger with current active language label', () => {
    // Force English initially
    void i18next.changeLanguage('en');
    render(<LanguageSwitcher />);

    const trigger = screen.getByTestId('lang-switcher-trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain('EN');
  });

  it('toggles dropdown menu on trigger click', () => {
    render(<LanguageSwitcher />);
    const trigger = screen.getByTestId('lang-switcher-trigger');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByTestId('lang-switcher-en')).toBeInTheDocument();
    expect(screen.getByTestId('lang-switcher-zh')).toBeInTheDocument();
    expect(screen.getByTestId('lang-switcher-ja')).toBeInTheDocument();
    expect(screen.getByTestId('lang-switcher-de')).toBeInTheDocument();
    expect(screen.getByTestId('lang-switcher-fr')).toBeInTheDocument();
    expect(screen.getByTestId('lang-switcher-es')).toBeInTheDocument();
    expect(screen.getByTestId('lang-switcher-ru')).toBeInTheDocument();

    // Toggle off
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes dropdown when clicking outside', () => {
    render(
      <div>
        <LanguageSwitcher />
        <div data-testid="outside">Outside</div>
      </div>
    );
    const trigger = screen.getByTestId('lang-switcher-trigger');

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes dropdown when pressing Escape', () => {
    render(<LanguageSwitcher />);
    const trigger = screen.getByTestId('lang-switcher-trigger');

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps the dropdown compact and inside the viewport', () => {
    vi.stubGlobal('innerWidth', 390);
    render(<LanguageSwitcher />);
    const trigger = screen.getByTestId('lang-switcher-trigger');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 188,
      height: 40,
      left: 41,
      right: 109,
      toJSON: () => ({}),
      top: 148,
      width: 68,
      x: 41,
      y: 148,
    });

    fireEvent.click(trigger);

    const menu = screen.getByRole('menu');
    expect(menu).toHaveStyle({ left: '8px', top: '194px', width: '144px' });
  });

  it('changes language and closes dropdown when selecting an option', () => {
    void i18next.changeLanguage('en');
    render(<LanguageSwitcher />);
    const trigger = screen.getByTestId('lang-switcher-trigger');

    fireEvent.click(trigger);
    const zhOption = screen.getByTestId('lang-switcher-zh');
    fireEvent.click(zhOption);

    expect(i18next.language).toBe('zh');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('focuses the active language option when opened', async () => {
    void i18next.changeLanguage('zh');
    render(<LanguageSwitcher />);

    // Using fake timers because requestAnimationFrame is used for focus
    vi.useFakeTimers();

    const trigger = screen.getByTestId('lang-switcher-trigger');
    fireEvent.click(trigger);

    // Fast-forward requestAnimationFrame
    vi.runAllTimers();

    const zhOption = screen.getByTestId('lang-switcher-zh');
    expect(document.activeElement).toBe(zhOption);
  });

  it('supports ArrowDown and ArrowUp navigation correctly', async () => {
    void i18next.changeLanguage('en');
    render(<LanguageSwitcher />);
    vi.useFakeTimers();

    const trigger = screen.getByTestId('lang-switcher-trigger');
    fireEvent.click(trigger);
    vi.runAllTimers();

    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitemradio');

    // Initial focus should be EN (if language is EN)
    expect(document.activeElement).toBe(items[0]);

    for (const item of items.slice(1)) {
      fireEvent.keyDown(menu, { key: 'ArrowDown', code: 'ArrowDown' });
      expect(document.activeElement).toBe(item);
    }

    // Arrow down wraps to EN
    fireEvent.keyDown(menu, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);

    // Arrow up wraps to the final option
    fireEvent.keyDown(menu, { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement).toBe(items.at(-1));
  });

  it('closes dropdown and focuses trigger when pressing Tab', async () => {
    render(<LanguageSwitcher />);
    vi.useFakeTimers();

    const trigger = screen.getByTestId('lang-switcher-trigger');
    trigger.focus();
    fireEvent.click(trigger);
    vi.runAllTimers();

    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'Tab', code: 'Tab' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});
