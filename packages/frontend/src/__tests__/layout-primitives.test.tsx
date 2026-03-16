import type { ChannelState } from '@zerolink/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  PageCard,
  PageCardContent,
  PageCardTitle,
  type PageCardTone,
  RoleBadge,
  StatusBadge,
} from '../components/layout';

describe('layout primitives', () => {
  it('renders PageCardTitle as h3 by default', () => {
    const html = renderToStaticMarkup(<PageCardTitle>Default title</PageCardTitle>);

    expect(html.startsWith('<h3')).toBe(true);
    expect(html).toContain('data-slot="card-title"');
    expect(html).toContain('Default title');
  });

  it('supports semantic heading override with asChild', () => {
    const html = renderToStaticMarkup(
      <PageCardTitle asChild>
        <h2>Section title</h2>
      </PageCardTitle>
    );

    expect(html.startsWith('<h2')).toBe(true);
    expect(html).toContain('data-slot="card-title"');
    expect(html).toContain('Section title');
  });

  it('renders page card with data-slot and tone-specific classes', () => {
    const tones: PageCardTone[] = ['purple', 'magenta', 'orange', 'cyan'];

    for (const tone of tones) {
      const html = renderToStaticMarkup(<PageCard tone={tone}>Card content</PageCard>);
      expect(html).toContain('data-slot="card"');
      expect(html).toContain('Card content');
    }
  });

  it('keeps custom class names on page card', () => {
    const html = renderToStaticMarkup(
      <PageCard className="custom-page-card">Card content</PageCard>
    );

    expect(html).toContain('custom-page-card');
  });

  it('renders sender and receiver role badges with correct labels', () => {
    const senderHtml = renderToStaticMarkup(<RoleBadge party="sender" />);
    const receiverHtml = renderToStaticMarkup(<RoleBadge party="receiver" />);

    expect(senderHtml).toContain('Sender');
    expect(receiverHtml).toContain('Receiver');
  });

  it('allows custom children on role badge', () => {
    const html = renderToStaticMarkup(<RoleBadge party="sender">Custom Label</RoleBadge>);

    expect(html).toContain('Custom Label');
    expect(html).not.toContain('Sender');
  });

  it('renders status badge with correct label and data attribute', () => {
    const statusChecks: Array<[ChannelState, string]> = [
      ['waiting', 'Waiting for Lock'],
      ['locked', 'Locked by Receiver'],
      ['delivered', 'Delivered'],
      ['deleted', 'Deleted'],
      ['expired', 'Expired'],
    ];

    for (const [status, label] of statusChecks) {
      const html = renderToStaticMarkup(<StatusBadge status={status} />);

      expect(html).toContain(`data-status="${status}"`);
      expect(html).toContain(label);
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it('applies custom class names on page card content', () => {
    const html = renderToStaticMarkup(
      <PageCardContent className="custom-content">Body text</PageCardContent>
    );

    expect(html).toContain('custom-content');
    expect(html).toContain('Body text');
    expect(html).toContain('data-slot="card-content"');
  });
});
