import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CardTitle } from '../components/ui/card';

describe('card title semantics', () => {
  it('renders h3 by default', () => {
    const html = renderToStaticMarkup(<CardTitle>Default title</CardTitle>);

    expect(html.startsWith('<h3')).toBe(true);
    expect(html).toContain('Default title');
  });

  it('supports semantic heading override with asChild', () => {
    const html = renderToStaticMarkup(
      <CardTitle asChild>
        <h2>Section title</h2>
      </CardTitle>
    );

    expect(html.startsWith('<h2')).toBe(true);
    expect(html).toContain('data-slot="card-title"');
    expect(html).toContain('Section title');
  });
});
