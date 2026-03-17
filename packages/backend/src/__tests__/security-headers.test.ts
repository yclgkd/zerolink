import { describe, expect, it } from 'vitest';

import { applySecurityHeaders } from '../security-headers.ts';

function makeResponse(
  body = 'hello',
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(body, {
    status,
    ...(extraHeaders ? { headers: extraHeaders } : {}),
  });
}

describe('applySecurityHeaders', () => {
  it('adds all security headers to a plain asset response', () => {
    const response = applySecurityHeaders(makeResponse(), '/index.html');

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(response.headers.get('Permissions-Policy')).toBe(
      'geolocation=(), microphone=(), camera=()'
    );
    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
  });

  it('sets Cache-Control: no-store for non-asset paths', () => {
    expect(applySecurityHeaders(makeResponse(), '/').headers.get('Cache-Control')).toBe('no-store');
    expect(
      applySecurityHeaders(makeResponse(), '/s/abcdefghijklmnopqrstu').headers.get('Cache-Control')
    ).toBe('no-store');
    expect(
      applySecurityHeaders(makeResponse(), '/api/public/xyz').headers.get('Cache-Control')
    ).toBe('no-store');
  });

  it('sets Cache-Control: immutable for /assets/* paths', () => {
    const response = applySecurityHeaders(makeResponse(), '/assets/index-abc123.js');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('preserves original response body and status', () => {
    const original = makeResponse('{"ok":true}', 201);
    const result = applySecurityHeaders(original, '/api/something');

    expect(result.status).toBe(201);
  });

  it('preserves original Content-Type header', () => {
    const original = makeResponse('{}', 200, { 'Content-Type': 'application/json' });
    const result = applySecurityHeaders(original, '/api/data');

    expect(result.headers.get('Content-Type')).toBe('application/json');
  });

  it('also applies security headers to non-2xx responses', () => {
    const original = makeResponse('Not Found', 404);
    const result = applySecurityHeaders(original, '/missing');

    expect(result.status).toBe(404);
    expect(result.headers.get('X-Frame-Options')).toBe('DENY');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });
});
