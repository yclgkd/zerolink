import { describe, expect, it } from 'vitest';

import worker, { type Env } from '../index.ts';

interface ApiErrorResponse {
  ok: false;
  code: string;
}

const env: Env = {
  SECRET_VAULT: {} as DurableObjectNamespace,
  SECRETS_KV: {} as KVNamespace,
};

const ctx = {
  passThroughOnException(): void {},
  waitUntil(_promise: Promise<unknown>): void {},
} as ExecutionContext;

const STUB_ROUTES = [
  { method: 'GET', path: '/api/public/abc123' },
  { method: 'POST', path: '/api/create_begin/abc123' },
  { method: 'POST', path: '/api/create_finish/abc123' },
  { method: 'POST', path: '/api/lock_begin/abc123' },
  { method: 'POST', path: '/api/lock_commit/abc123' },
  { method: 'POST', path: '/api/manage/compound_begin/abc123' },
  { method: 'POST', path: '/api/manage/compound_commit/abc123' },
] as const;

async function dispatch(path: string, method: string): Promise<Response> {
  const fetchHandler = worker.fetch;
  if (!fetchHandler) {
    throw new Error('worker fetch handler is missing');
  }

  const invoke = fetchHandler as unknown as (
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<Response>;
  const request = new Request(`https://zerolink.test${path}`, { method });

  return invoke(request, env, ctx);
}

describe('backend worker routing skeleton', () => {
  for (const route of STUB_ROUTES) {
    it(`returns 501 stub response for ${route.method} ${route.path}`, async () => {
      const response = await dispatch(route.path, route.method);
      const payload = (await response.json()) as ApiErrorResponse;

      expect(response.status).toBe(501);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(payload).toEqual({
        ok: false,
        code: 'NOT_IMPLEMENTED',
      });
    });
  }

  it('handles preflight OPTIONS for /api/*', async () => {
    const response = await dispatch('/api/lock_begin/abc123', 'OPTIONS');

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, Authorization'
    );
  });

  it('returns 404 for unknown /api path with CORS headers', async () => {
    const response = await dispatch('/api/unknown/abc123', 'GET');
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(404);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(payload).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('returns 405 for method mismatch on known /api route', async () => {
    const response = await dispatch('/api/create_begin/abc123', 'GET');
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(405);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    expect(payload).toEqual({
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
    });
  });

  it('returns health text for non-api route', async () => {
    const response = await dispatch('/', 'GET');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe('ZeroLink API');
  });
});
