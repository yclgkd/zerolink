// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';

import { LanguageSwitcher } from '../language-switcher';

describe('LanguageSwitcher', () => {
  afterEach(() => {
    cleanup();
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
});
