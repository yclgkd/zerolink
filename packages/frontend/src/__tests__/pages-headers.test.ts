import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

describe('Cloudflare Pages headers', () => {
  let headers: string;

  beforeAll(() => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const frontendDir = path.resolve(testDir, '..', '..');
    headers = readFileSync(path.join(frontendDir, 'public', '_headers'), 'utf8');
  });

  it('marks SPA entry requests as no-cache and hashed assets as immutable', () => {
    expect(headers).toContain('/*\n  Cache-Control: no-cache');
    expect(headers).toContain(
      '/assets/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable'
    );
  });

  it('sets security headers on all responses', () => {
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(headers).toContain('Cross-Origin-Opener-Policy: same-origin');
    expect(headers).toContain(
      'Strict-Transport-Security: max-age=63072000; includeSubDomains; preload'
    );
  });

  it('includes a Content-Security-Policy with required directives', () => {
    expect(headers).toContain('Content-Security-Policy:');
    expect(headers).toContain("default-src 'self'");
    expect(headers).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(headers).toContain("frame-ancestors 'none'");
  });
});
