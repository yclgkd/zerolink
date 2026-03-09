import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Cloudflare Pages headers', () => {
  it('marks SPA entry requests as no-store and hashed assets as immutable', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const frontendDir = path.resolve(testDir, '..', '..');
    const headers = readFileSync(path.join(frontendDir, 'public', '_headers'), 'utf8');

    expect(headers).toContain('/*\n  Cache-Control: no-store');
    expect(headers).toContain(
      '/assets/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable'
    );
  });
});
