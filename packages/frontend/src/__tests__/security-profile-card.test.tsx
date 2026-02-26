// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SECURITY_PROFILE, type SecurityProfile } from '@zerolink/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SecurityProfileCard,
  SecurityProfileCardConfigs,
} from '../components/create/security-profile-card';

const profiles: SecurityProfile[] = Object.values(SECURITY_PROFILE);

describe('SecurityProfileCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders standard profile copy and icon marker', () => {
    render(<SecurityProfileCard onSelect={() => {}} profile="standard" selected={false} />);

    expect(screen.getByText('Standard')).toBeTruthy();
    expect(screen.getByText(SecurityProfileCardConfigs.standard.tagline)).toBeTruthy();
    expect(screen.getByText('Passkeys or security keys')).toBeTruthy();
    expect(screen.getByTestId('security-profile-icon-standard')).toBeTruthy();
  });

  it('renders strict profile with magenta tone classes', () => {
    render(<SecurityProfileCard onSelect={() => {}} profile="strict" selected={false} />);

    const card = screen.getByTestId('security-profile-card-strict');
    expect(card.className).toContain('border-neon-magenta/30');
    expect(card.className).toContain('shadow-neon-magenta/15');
  });

  it('renders hardware-only profile with orange tone classes and label', () => {
    render(<SecurityProfileCard onSelect={() => {}} profile="hardware_only" selected={false} />);

    const card = screen.getByTestId('security-profile-card-hardware_only');
    expect(screen.getByText('Hardware-Only')).toBeTruthy();
    expect(card.className).toContain('border-neon-orange/30');
    expect(card.className).toContain('shadow-neon-orange/15');
  });

  it('applies selected ring class only when selected', () => {
    const { rerender } = render(
      <SecurityProfileCard onSelect={() => {}} profile="standard" selected={false} />
    );

    const card = screen.getByTestId('security-profile-card-standard');
    expect(card.className).not.toContain('ring-2');

    rerender(<SecurityProfileCard onSelect={() => {}} profile="standard" selected />);
    expect(card.className).toContain('ring-2');
    expect(card.className).toContain('ring-neon-purple/60');
  });

  it('calls onSelect once when card is clicked', () => {
    const onSelect = vi.fn();
    render(<SecurityProfileCard onSelect={onSelect} profile="strict" selected={false} />);

    fireEvent.click(screen.getByTestId('security-profile-card-strict'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('strict');
  });

  it('calls onSelect on Enter key', () => {
    const onSelect = vi.fn();
    render(<SecurityProfileCard onSelect={onSelect} profile="standard" selected={false} />);

    fireEvent.keyDown(screen.getByTestId('security-profile-card-standard'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('standard');
  });

  it('calls onSelect on Space key', () => {
    const onSelect = vi.fn();
    render(<SecurityProfileCard onSelect={onSelect} profile="standard" selected={false} />);

    fireEvent.keyDown(screen.getByTestId('security-profile-card-standard'), { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('standard');
  });

  it('toggles details when learn more is clicked', () => {
    render(<SecurityProfileCard onSelect={() => {}} profile="strict" selected={false} />);

    const learnMore = screen.getByTestId('security-profile-learn-more-strict');
    expect(learnMore.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('security-profile-details-strict')).toBeNull();

    fireEvent.click(learnMore);
    expect(learnMore.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('security-profile-details-strict')).toBeTruthy();

    fireEvent.click(learnMore);
    expect(learnMore.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('security-profile-details-strict')).toBeNull();
  });

  it('does not trigger onSelect when learn more is clicked', () => {
    const onSelect = vi.fn();
    render(<SecurityProfileCard onSelect={onSelect} profile="strict" selected={false} />);

    fireEvent.click(screen.getByTestId('security-profile-learn-more-strict'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('updates aria attributes for selected and expanded state', () => {
    render(<SecurityProfileCard onSelect={() => {}} profile="standard" selected />);

    const card = screen.getByTestId('security-profile-card-standard');
    const learnMore = screen.getByTestId('security-profile-learn-more-standard');

    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(learnMore.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(learnMore);
    expect(learnMore.getAttribute('aria-expanded')).toBe('true');
  });

  it('merges custom className with defaults', () => {
    render(
      <SecurityProfileCard
        className="custom-security-profile"
        onSelect={() => {}}
        profile="hardware_only"
        selected={false}
      />
    );

    const card = screen.getByTestId('security-profile-card-hardware_only');
    expect(card.className).toContain('custom-security-profile');
    expect(card.className).toContain('border-neon-orange/30');
  });

  it('covers all supported profiles in config mapping', () => {
    for (const profile of profiles) {
      expect(SecurityProfileCardConfigs[profile]).toBeTruthy();
    }
  });
});
