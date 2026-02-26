import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  type ChannelStatus,
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

  it('maps page card tone classes', () => {
    const toneChecks: Array<[PageCardTone, string]> = [
      ['purple', 'shadow-[0_0_30px_rgb(168_85_247_/_0.15)]'],
      ['magenta', 'shadow-[0_0_30px_rgb(236_72_153_/_0.15)]'],
      ['orange', 'shadow-[0_0_30px_rgb(249_115_22_/_0.15)]'],
      ['cyan', 'shadow-[0_0_30px_rgb(6_182_212_/_0.15)]'],
    ];

    for (const [tone, expectedClass] of toneChecks) {
      const html = renderToStaticMarkup(<PageCard tone={tone}>Card content</PageCard>);
      expect(html).toContain(expectedClass);
    }
  });

  it('keeps custom class names on page card', () => {
    const html = renderToStaticMarkup(
      <PageCard className="custom-page-card">Card content</PageCard>
    );

    expect(html).toContain('custom-page-card');
  });

  it('maps sender and receiver role badge styles', () => {
    const senderHtml = renderToStaticMarkup(<RoleBadge party="sender" />);
    const receiverHtml = renderToStaticMarkup(<RoleBadge party="receiver" />);

    expect(senderHtml).toContain('Sender');
    expect(senderHtml).toContain('border-[color:rgb(168_85_247_/_0.35)]');
    expect(receiverHtml).toContain('Receiver');
    expect(receiverHtml).toContain('border-[color:rgb(6_182_212_/_0.4)]');
  });

  it('maps status badge labels and style classes', () => {
    const statusChecks: Array<[ChannelStatus, string, string]> = [
      ['waiting', 'Waiting for Lock', 'text-[#f59e0b]'],
      ['locked', 'Locked by Receiver', 'text-[#06b6d4]'],
      ['delivered', 'Delivered', 'text-[#10b981]'],
      ['deleted', 'Deleted', 'text-[#64748b]'],
      ['expired', 'Expired', 'text-[#ef4444]'],
    ];

    for (const [status, label, expectedClass] of statusChecks) {
      const html = renderToStaticMarkup(<StatusBadge status={status} />);

      expect(html).toContain(`data-status="${status}"`);
      expect(html).toContain(label);
      expect(html).toContain(expectedClass);
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it('applies default and custom content classes', () => {
    const html = renderToStaticMarkup(
      <PageCardContent className="custom-content">Body text</PageCardContent>
    );

    expect(html).toContain('pt-0 text-sm text-muted-foreground');
    expect(html).toContain('custom-content');
    expect(html).toContain('Body text');
  });
});
