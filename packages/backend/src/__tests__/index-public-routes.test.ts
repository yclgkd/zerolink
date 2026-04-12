import { describe, expect, it } from 'vitest';

import {
  type ApiErrorResponse,
  createMockEnv,
  dispatch,
  VALID_UUID,
} from './helpers/worker-fixtures.ts';

describe('backend worker routing — public/read routes', () => {
  it('serves deployment file policy without hitting the Durable Object', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
    });
    env.FILE_MAX_BYTES = 1_048_576;
    env.FILE_MULTIPART_THRESHOLD_BYTES = 1_048_576;
    env.FILE_CHUNK_SIZE_BYTES = 262_144;
    env.FILE_MAX_CHUNKS = 4;

    const response = await dispatch(env, '/api/file_policy', 'GET');
    const payload = (await response.json()) as {
      ok: true;
      policy: {
        maxFileBytes: number;
        multipartThresholdBytes: number;
        chunkSizeBytes: number;
        maxChunks: number;
        multipartSupported: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      policy: {
        maxFileBytes: 1_048_576,
        multipartThresholdBytes: 1_048_576,
        chunkSizeBytes: 262_144,
        maxChunks: 4,
        multipartSupported: true,
      },
    });
    expect(calls).toHaveLength(0);
  });

  it('forwards GET /api/public/:uuid to SecretVault DO get_public_state', async () => {
    const publicStateResponse = {
      ok: true,
      state: 'waiting',
      adminMode: 'webauthn',
      securityProfile: 'secure',
    };
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify(publicStateResponse), { status: 200 });
    });

    const response = await dispatch(env, `/api/public/${VALID_UUID}`, 'GET');
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(payload).toEqual(publicStateResponse);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/get_public_state');
    expect(calls[0]?.method).toBe('POST');
  });

  it('propagates not-found from public and decrypt read routes', async () => {
    const { env } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), {
        status: 404,
      });
    });

    const publicResponse = await dispatch(env, `/api/public/${VALID_UUID}`, 'GET');
    const publicPayload = (await publicResponse.json()) as ApiErrorResponse;
    expect(publicResponse.status).toBe(404);
    expect(publicPayload).toEqual({ ok: false, code: 'NOT_FOUND' });

    const decryptResponse = await dispatch(env, `/api/decrypt_fetch/${VALID_UUID}`, 'GET');
    const decryptPayload = (await decryptResponse.json()) as ApiErrorResponse;
    expect(decryptResponse.status).toBe(404);
    expect(decryptPayload).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('forwards websocket upgrade requests to SecretVault DO', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), {
        status: 404,
      });
    });

    const response = await dispatch(env, `/api/ws/${VALID_UUID}`, 'GET', undefined, false, {
      Origin: 'https://zerolink.test',
      Upgrade: 'websocket',
    });
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(404);
    expect(payload).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/ws');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.body).toBeNull();
  });

  it('rejects websocket upgrades from unexpected origins before reaching the Durable Object', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
    });

    const response = await dispatch(env, `/api/ws/${VALID_UUID}`, 'GET', undefined, false, {
      Origin: 'https://attacker.test',
      Upgrade: 'websocket',
    });
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(403);
    expect(payload).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(calls).toHaveLength(0);
  });
});
