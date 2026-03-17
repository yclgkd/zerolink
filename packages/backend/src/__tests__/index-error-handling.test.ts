import { describe, expect, it } from 'vitest';

import {
  type ApiErrorResponse,
  createMockEnv,
  dispatch,
  VALID_LOCK_COMMIT_BODY,
  VALID_UUID,
} from './helpers/worker-fixtures.ts';

describe('backend worker routing — error handling (400/404/405/500 + CORS + UUID + health)', () => {
  it('returns 500 when DO forwarding throws', async () => {
    const { env } = createMockEnv(async () => {
      throw new Error('boom');
    });

    const response = await dispatch(
      env,
      `/api/lock_commit/${VALID_UUID}`,
      'POST',
      VALID_LOCK_COMMIT_BODY
    );
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(500);
    expect(payload.code).toBe('INTERNAL_ERROR');
  });

  it('handles preflight OPTIONS for /api/*', async () => {
    const { env } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
    });
    const response = await dispatch(env, '/api/lock_begin/abc123', 'OPTIONS');

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, Authorization'
    );
  });

  it('returns 404 for unknown /api path with CORS headers', async () => {
    const { env } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
    });
    const response = await dispatch(env, '/api/unknown/abc123', 'GET');
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(404);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
    expect(payload).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('returns 405 for method mismatch on known non-lock /api route', async () => {
    const { env } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
    });
    const response = await dispatch(env, '/api/create_begin/abc123', 'GET');
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(405);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    expect(payload).toEqual({
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
    });
  });

  it('delegates non-api route to ASSETS and applies security headers', async () => {
    const { env } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
    });
    const response = await dispatch(env, '/', 'GET');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe('<html>ZeroLink</html>');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  describe('UUID validation', () => {
    it('rejects invalid UUID on GET /api/public/:uuid', async () => {
      const { env } = createMockEnv(async () => new Response('{}', { status: 200 }));
      const response = await dispatch(env, '/api/public/not-a-valid-uuid!!', 'GET');
      const payload = (await response.json()) as ApiErrorResponse;
      expect(response.status).toBe(400);
      expect(payload.code).toBe('BAD_REQUEST');
    });

    it('rejects UUID that is too short on POST /api/lock_begin/:uuid', async () => {
      const { env } = createMockEnv(async () => new Response('{}', { status: 200 }));
      const response = await dispatch(env, '/api/lock_begin/tooshort', 'POST', {});
      const payload = (await response.json()) as ApiErrorResponse;
      expect(response.status).toBe(400);
      expect(payload.code).toBe('BAD_REQUEST');
    });

    it('rejects UUID that is too long on POST /api/create_begin/:uuid', async () => {
      const { env } = createMockEnv(async () => new Response('{}', { status: 200 }));
      const response = await dispatch(env, `/api/create_begin/${'a'.repeat(22)}`, 'POST', {});
      const payload = (await response.json()) as ApiErrorResponse;
      expect(response.status).toBe(400);
      expect(payload.code).toBe('BAD_REQUEST');
    });

    it('accepts a valid UUID on GET /api/public/:uuid', async () => {
      const { env } = createMockEnv(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              state: 'waiting',
              adminMode: 'webauthn',
              securityProfile: 'secure',
            }),
            {
              status: 200,
            }
          )
      );
      const response = await dispatch(env, `/api/public/${VALID_UUID}`, 'GET');
      expect(response.status).not.toBe(400);
    });
  });

  it('returns 500 INTERNAL_ERROR when worker.fetch throws unexpectedly', async () => {
    const { env } = createMockEnv(async () => {
      throw new Error('unexpected runtime failure');
    });
    // Trigger a route that reaches the DO stub (which will throw)
    const response = await dispatch(env, `/api/public/${VALID_UUID}`, 'GET');
    const payload = (await response.json()) as ApiErrorResponse;
    expect(response.status).toBe(500);
    expect(payload.code).toBe('INTERNAL_ERROR');
  });
});
