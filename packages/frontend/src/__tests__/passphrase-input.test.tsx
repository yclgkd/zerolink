// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PassphraseInput } from '../components/lock/passphrase-input';

describe('PassphraseInput', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders password input by default', () => {
    render(<PassphraseInput onChange={() => {}} value="" />);

    const input = screen.getByTestId('passphrase-input-field');
    expect(input.getAttribute('type')).toBe('password');
  });

  it('toggles passphrase visibility when the button is clicked', () => {
    render(<PassphraseInput onChange={() => {}} value="abc" />);

    const input = screen.getByTestId('passphrase-input-field');
    const toggle = screen.getByRole('button', { name: 'Show passphrase' });

    fireEvent.click(toggle);
    expect(input.getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide passphrase' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide passphrase' }));
    expect(input.getAttribute('type')).toBe('password');
  });

  it('calls onChange with the updated value', () => {
    const onChange = vi.fn();
    render(<PassphraseInput onChange={onChange} value="" />);

    fireEvent.change(screen.getByTestId('passphrase-input-field'), {
      target: { value: 'new-passphrase' },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('new-passphrase');
  });

  it('hides the strength section when showStrength is false', () => {
    render(<PassphraseInput onChange={() => {}} showStrength={false} value="Password12!" />);

    expect(screen.queryByText('Passphrase strength')).toBeNull();
  });

  it('shows strength label and three segments when value is non-empty', () => {
    render(<PassphraseInput onChange={() => {}} value="Password12" />);

    expect(screen.getByText('Passphrase strength')).toBeTruthy();
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(screen.getAllByTestId(/passphrase-strength-segment-/)).toHaveLength(3);
  });

  it('merges custom className with default container classes', () => {
    render(<PassphraseInput className="custom-passphrase-root" onChange={() => {}} value="" />);

    expect(screen.getByTestId('passphrase-input-root').className).toContain(
      'custom-passphrase-root'
    );
  });

  it('binds custom label and input id', () => {
    render(
      <PassphraseInput
        inputId="lock-passphrase"
        label="Lock passphrase"
        onChange={() => {}}
        value=""
      />
    );

    const input = screen.getByLabelText('Lock passphrase');
    expect(input.getAttribute('id')).toBe('lock-passphrase');
  });

  it('forwards aria-invalid and aria-describedby to the input', () => {
    render(
      <PassphraseInput
        ariaDescribedBy="share-lock-error"
        ariaInvalid
        onChange={() => {}}
        value="abc"
      />
    );

    const input = screen.getByTestId('passphrase-input-field');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('share-lock-error');
  });

  it('disables browser autocomplete on passphrase inputs', () => {
    render(<PassphraseInput onChange={() => {}} value="" />);

    const input = screen.getByTestId('passphrase-input-field');
    expect(input.getAttribute('autocomplete')).toBe('off');
  });
});
