import { describe, expect, it } from 'vitest';

import worker, { type Env } from '../index.ts';

interface ApiErrorResponse {
  ok: false;
  code: string;
}

interface VaultCall {
  pathname: string;
  method: string;
  body: string | null;
}

const ctx = {
  passThroughOnException(): void {},
  waitUntil(_promise: Promise<unknown>): void {},
} as ExecutionContext;

const STUB_ROUTES = [
  { method: 'GET', path: '/api/public/abc123' },
  { method: 'POST', path: '/api/create_begin/abc123' },
  { method: 'POST', path: '/api/create_finish/abc123' },
] as const;

const VALID_UUID = 'abcdefghijklmnopqrstu';
const OTHER_UUID = 'zzzzzzzzzzzzzzzzzzzzz';

const VALID_LOCK_COMMIT_BODY = {
  uuid: VALID_UUID,
  lockChallengeId: 'challenge_id_01',
  lockProof: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  receiverPubJwk: {
    kty: 'RSA',
    alg: 'RSA-OAEP-256',
    n: 'modulusvalue',
    e: 'AQAB',
    ext: true,
    key_ops: ['encrypt'],
  },
  receiverPubFpr: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  lockedAt: 1_730_000_000_000,
} as const;

const VALID_COMPOUND_BEGIN_BODY = {
  uuid: VALID_UUID,
} as const;

const VALID_ASSERTION = {
  id: 'credential_id',
  rawId: 'credential_id',
  type: 'public-key',
  response: {
    clientDataJSON: 'client_data',
    authenticatorData: 'auth_data',
    signature: 'signature_data',
  },
} as const;

const VALID_UPDATE_INTENT = {
  op: 'update',
  uuid: VALID_UUID,
  version: 0,
  timestamp: 1_730_000_000_000,
  nonce: 'nonce_value',
  receiverPubFpr: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  cipherBundle: {
    ciphertext: 'ciphertext',
    iv: 'ivvalue123',
    aad: 'aadvalue',
    encContentKey: 'enckeyvalue',
    ciphertextHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    padBlock: 4096,
  },
  expireAt: null,
} as const;

const VALID_DELETE_INTENT = {
  op: 'delete',
  uuid: VALID_UUID,
  version: 1,
  timestamp: 1_730_000_100_000,
  nonce: 'nonce_delete',
} as const;

const VALID_COMPOUND_COMMIT_UPDATE_BODY = {
  uuid: VALID_UUID,
  assertion: VALID_ASSERTION,
  intentHash: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  intent: VALID_UPDATE_INTENT,
} as const;

const VALID_COMPOUND_COMMIT_DELETE_BODY = {
  uuid: VALID_UUID,
  assertion: VALID_ASSERTION,
  intentHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  intent: VALID_DELETE_INTENT,
} as const;

function createMockEnv(responder: (request: Request) => Promise<Response> | Response): {
  env: Env;
  calls: VaultCall[];
} {
  const calls: VaultCall[] = [];
  const stub = {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.toString(), init);
      const body =
        request.method === 'GET' || request.method === 'HEAD' ? null : await request.clone().text();

      calls.push({
        pathname: new URL(request.url).pathname,
        method: request.method,
        body,
      });

      return responder(request);
    },
  } as unknown as DurableObjectStub;

  const namespace = {
    idFromName(name: string): DurableObjectId {
      return { toString: () => name } as unknown as DurableObjectId;
    },
    get(_id: DurableObjectId): DurableObjectStub {
      return stub;
    },
  } as unknown as DurableObjectNamespace;

  return {
    env: {
      SECRET_VAULT: namespace,
      SECRETS_KV: {} as KVNamespace,
      RP_ID: 'zerolink.test',
      RP_ORIGIN: 'https://zerolink.test',
    },
    calls,
  };
}

async function dispatch(
  env: Env,
  path: string,
  method: string,
  body?: unknown,
  rawBody: boolean = false
): Promise<Response> {
  const fetchHandler = worker.fetch;
  if (!fetchHandler) {
    throw new Error('worker fetch handler is missing');
  }

  const invoke = fetchHandler as unknown as (
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<Response>;

  const request =
    body === undefined
      ? new Request(`https://zerolink.test${path}`, { method })
      : new Request(`https://zerolink.test${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: rawBody ? String(body) : JSON.stringify(body),
        });

  return invoke(request, env, ctx);
}

describe('backend worker routing + lock/compound forwarding', () => {
  for (const route of STUB_ROUTES) {
    it(`returns 501 stub response for ${route.method} ${route.path}`, async () => {
      const { env, calls } = createMockEnv(async () => {
        return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
      });
      const response = await dispatch(env, route.path, route.method);
      const payload = (await response.json()) as ApiErrorResponse;

      expect(response.status).toBe(501);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(payload).toEqual({
        ok: false,
        code: 'NOT_IMPLEMENTED',
      });
      expect(calls).toHaveLength(0);
    });
  }

  it('forwards lock_begin request to SecretVault DO and returns challenge response', async () => {
    const challengeResponse = {
      ok: true,
      lockChallenge: {
        id: 'challenge-id',
        challenge: 'challenge-token',
        expiresAt: 1_730_000_123_000,
      },
    };
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify(challengeResponse), { status: 200 });
    });

    const response = await dispatch(env, `/api/lock_begin/${VALID_UUID}`, 'POST', {
      uuid: VALID_UUID,
    });
    const payload = (await response.json()) as {
      ok: true;
      lockChallenge: { id: string; challenge: string; expiresAt: number };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(payload).toEqual(challengeResponse);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/lock_begin');
    expect(calls[0]?.method).toBe('POST');
  });

  it('forwards lock_commit request to SecretVault DO and returns ok response', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const response = await dispatch(
      env,
      `/api/lock_commit/${VALID_UUID}`,
      'POST',
      VALID_LOCK_COMMIT_BODY
    );
    const payload = (await response.json()) as { ok: true };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/lock_commit');
    expect(calls[0]?.method).toBe('POST');
  });

  it('forwards compound_begin request to SecretVault DO and returns challenge response', async () => {
    const compoundBeginResponse = {
      ok: true,
      challenge: {
        id: 'compound-id',
        seed: 'compound-seed',
        expiresAt: 1_730_000_123_000,
      },
      currentVersion: 2,
      receiverPubFpr: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    };
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify(compoundBeginResponse), { status: 200 });
    });

    const response = await dispatch(
      env,
      `/api/manage/compound_begin/${VALID_UUID}`,
      'POST',
      VALID_COMPOUND_BEGIN_BODY
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toEqual(compoundBeginResponse);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/compound_begin');
    expect(calls[0]?.method).toBe('POST');
  });

  it('forwards compound_commit request to SecretVault DO and returns ok response', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const response = await dispatch(
      env,
      `/api/manage/compound_commit/${VALID_UUID}`,
      'POST',
      VALID_COMPOUND_COMMIT_UPDATE_BODY
    );
    const payload = (await response.json()) as { ok: true };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/compound_commit');
    expect(calls[0]?.method).toBe('POST');
  });

  it('forwards delete_commit alias to SecretVault compound_commit', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const response = await dispatch(
      env,
      `/api/delete_commit/${VALID_UUID}`,
      'POST',
      VALID_COMPOUND_COMMIT_DELETE_BODY
    );
    const payload = (await response.json()) as { ok: true };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/compound_commit');
    expect(calls[0]?.method).toBe('POST');
  });

  it('returns 400 for invalid lock_begin payload and does not call DO', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });

    const response = await dispatch(env, `/api/lock_begin/${VALID_UUID}`, 'POST', {
      uuid: 'invalid-uuid',
    });
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(payload.code).toBe('BAD_REQUEST');
    expect(calls).toHaveLength(0);
  });

  it('returns 400 when path UUID and body UUID do not match', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });

    const response = await dispatch(env, `/api/lock_begin/${VALID_UUID}`, 'POST', {
      uuid: 'zzzzzzzzzzzzzzzzzzzzz',
    });
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(payload.code).toBe('BAD_REQUEST');
    expect(calls).toHaveLength(0);
  });

  it('returns 400 when path UUID and body UUID do not match on lock_commit', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });

    const response = await dispatch(env, `/api/lock_commit/${VALID_UUID}`, 'POST', {
      ...VALID_LOCK_COMMIT_BODY,
      uuid: 'zzzzzzzzzzzzzzzzzzzzz',
    });
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(payload.code).toBe('BAD_REQUEST');
    expect(calls).toHaveLength(0);
  });

  it('returns 400 for malformed JSON body on lock_commit', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });

    const response = await dispatch(
      env,
      `/api/lock_commit/${VALID_UUID}`,
      'POST',
      '{"uuid":',
      true
    );
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(payload.code).toBe('BAD_REQUEST');
    expect(calls).toHaveLength(0);
  });

  it('returns 400 for invalid compound_begin payload and does not call DO', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });

    const response = await dispatch(env, `/api/manage/compound_begin/${VALID_UUID}`, 'POST', {
      uuid: 'invalid',
    });
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(payload.code).toBe('BAD_REQUEST');
    expect(calls).toHaveLength(0);
  });

  it('returns 400 when compound_commit uuid values do not match route uuid', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });

    const response = await dispatch(env, `/api/manage/compound_commit/${VALID_UUID}`, 'POST', {
      ...VALID_COMPOUND_COMMIT_UPDATE_BODY,
      uuid: OTHER_UUID,
      intent: {
        ...VALID_UPDATE_INTENT,
        uuid: OTHER_UUID,
      },
    });
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(payload.code).toBe('BAD_REQUEST');
    expect(calls).toHaveLength(0);
  });

  it('returns 400 when delete_commit alias receives non-delete intent', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });

    const response = await dispatch(
      env,
      `/api/delete_commit/${VALID_UUID}`,
      'POST',
      VALID_COMPOUND_COMMIT_UPDATE_BODY
    );
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(payload.code).toBe('BAD_REQUEST');
    expect(calls).toHaveLength(0);
  });

  it('returns 405 for method mismatch on lock challenge routes', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });

    const response = await dispatch(env, `/api/lock_begin/${VALID_UUID}`, 'GET');
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    expect(payload.code).toBe('METHOD_NOT_ALLOWED');
    expect(calls).toHaveLength(0);
  });

  it('returns 405 for method mismatch on compound routes', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });

    const response = await dispatch(env, `/api/manage/compound_begin/${VALID_UUID}`, 'GET');
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    expect(payload.code).toBe('METHOD_NOT_ALLOWED');
    expect(calls).toHaveLength(0);
  });

  it('propagates lock challenge error statuses from DO', async () => {
    const scenarios = [
      { status: 401, code: 'CHALLENGE_INVALID' },
      { status: 403, code: 'LOCK_FORBIDDEN' },
      { status: 409, code: 'CHALLENGE_CONSUMED' },
      { status: 404, code: 'NOT_FOUND' },
    ] as const;

    for (const scenario of scenarios) {
      const { env } = createMockEnv(async () => {
        return new Response(JSON.stringify({ ok: false, code: scenario.code }), {
          status: scenario.status,
        });
      });

      const response = await dispatch(
        env,
        `/api/lock_commit/${VALID_UUID}`,
        'POST',
        VALID_LOCK_COMMIT_BODY
      );
      const payload = (await response.json()) as ApiErrorResponse;

      expect(response.status).toBe(scenario.status);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(payload).toEqual({ ok: false, code: scenario.code });
    }
  });

  it('propagates compound/delete error statuses from DO', async () => {
    const scenarios = [
      { status: 409, code: 'VERSION_MISMATCH' },
      { status: 409, code: 'NONCE_REPLAY' },
      { status: 400, code: 'TIMESTAMP_OUT_OF_RANGE' },
      { status: 400, code: 'INTENT_HASH_MISMATCH' },
      { status: 403, code: 'ASSERTION_INVALID' },
    ] as const;

    for (const scenario of scenarios) {
      const { env } = createMockEnv(async () => {
        return new Response(JSON.stringify({ ok: false, code: scenario.code }), {
          status: scenario.status,
        });
      });

      const response = await dispatch(
        env,
        `/api/manage/compound_commit/${VALID_UUID}`,
        'POST',
        VALID_COMPOUND_COMMIT_UPDATE_BODY
      );
      const payload = (await response.json()) as ApiErrorResponse;

      expect(response.status).toBe(scenario.status);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(payload).toEqual({ ok: false, code: scenario.code });
    }
  });

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
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
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
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });
    const response = await dispatch(env, '/api/unknown/abc123', 'GET');
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(404);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(payload).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('returns 405 for method mismatch on known non-lock /api route', async () => {
    const { env } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
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

  it('returns health text for non-api route', async () => {
    const { env } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), { status: 500 });
    });
    const response = await dispatch(env, '/', 'GET');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe('ZeroLink API');
  });
});
