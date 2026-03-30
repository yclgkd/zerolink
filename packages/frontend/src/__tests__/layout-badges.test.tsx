// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { CHANNEL_STATE } from '@zerolink/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { RoleBadge, StatusBadge } from '../components/layout';

describe('RoleBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders default sender and receiver labels', () => {
    const { rerender } = render(<RoleBadge party="sender" />);
    expect(screen.getByText('Sender')).toBeTruthy();

    rerender(<RoleBadge party="receiver" />);
    expect(screen.getByText('Receiver')).toBeTruthy();
  });

  it('keeps styles when overriding children content', () => {
    render(
      <RoleBadge className="custom-role-badge" party="sender">
        Owner
      </RoleBadge>
    );

    const badge = screen.getByText('Owner');
    expect(badge.className).toContain('custom-role-badge');
    expect(badge.className).toContain('border-neon-purple/22');
  });
});

describe('StatusBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('maps all channel states to expected labels', () => {
    const cases: Array<{
      status: (typeof CHANNEL_STATE)[keyof typeof CHANNEL_STATE];
      label: string;
    }> = [
      { status: CHANNEL_STATE.WAITING, label: 'Waiting for Lock' },
      { status: CHANNEL_STATE.LOCKED, label: 'Locked by Receiver' },
      { status: CHANNEL_STATE.DELIVERED, label: 'Delivered' },
      { status: CHANNEL_STATE.DELETED, label: 'Deleted' },
      { status: CHANNEL_STATE.EXPIRED, label: 'Expired' },
    ];

    const { rerender } = render(<StatusBadge status={CHANNEL_STATE.WAITING} />);
    for (const item of cases) {
      rerender(<StatusBadge status={item.status} />);
      expect(screen.getByText(item.label)).toBeTruthy();
      expect(
        screen.getByText(item.label).closest('[data-status]')?.getAttribute('data-status')
      ).toBe(item.status);
    }
  });

  it('merges custom className without dropping base status styles', () => {
    render(<StatusBadge className="custom-status-badge" status={CHANNEL_STATE.DELIVERED} />);

    const badge = screen.getByText('Delivered').closest('[data-status]');
    expect(badge?.className).toContain('custom-status-badge');
    expect(badge?.className).toContain('border-neon-green/24');
  });
});
