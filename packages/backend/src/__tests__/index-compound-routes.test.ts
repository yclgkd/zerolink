import { describe, expect, it } from 'vitest';

import {
  type ApiErrorResponse,
  createMockEnv,
  dispatch,
  getSetCookieHeaders,
  INTERNAL_COMMIT_COOKIE_ACTION_HEADER,
  INTERNAL_COMMIT_COOKIE_EXP_HEADER,
  INTERNAL_COMMIT_COOKIE_KIND_HEADER,
  INTERNAL_COMMIT_COOKIE_TOKEN_HEADER,
  OTHER_UUID,
  VALID_COMPOUND_BEGIN_BODY,
  VALID_COMPOUND_COMMIT_DELETE_BODY,
  VALID_COMPOUND_COMMIT_UPDATE_BODY,
  VALID_SOFTKEY_COMPOUND_COMMIT_DELETE_BODY,
  VALID_SOFTKEY_COMPOUND_COMMIT_UPDATE_BODY,
  VALID_UPDATE_INTENT,
  VALID_UUID,
} from './helpers/worker-fixtures.ts';

describe('backend worker routing — compound begin/commit forwarding + alias routes', () => {
  it('forwards compound_begin request to SecretVault DO and returns challenge response', async () => {
    const compoundBeginResponse = {
      ok: true,
      challenge: {
        id: 'compound-id',
        seed: 'compound-seed',
        expiresAt: 1_730_000_123_000,
      },
      allowCredentials: [{ id: 'credential-id', type: 'public-key' }],
      currentVersion: 2,
      adminMode: 'webauthn',
      receiverPubFpr: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    };
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify(compoundBeginResponse), {
        status: 200,
      });
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

  it('sets both compound cookie paths from internal begin signals', async () => {
    const { env } = createMockEnv(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          challenge: {
            id: 'compound-id',
            seed: 'compound-seed',
            expiresAt: 1_730_000_123_000,
          },
          currentVersion: 1,
          securityProfile: 'standard',
          adminMode: 'webauthn',
        }),
        {
          status: 200,
          headers: {
            [INTERNAL_COMMIT_COOKIE_ACTION_HEADER]: 'set',
            [INTERNAL_COMMIT_COOKIE_KIND_HEADER]: 'compound',
            [INTERNAL_COMMIT_COOKIE_TOKEN_HEADER]: 'compound-token-abc',
            [INTERNAL_COMMIT_COOKIE_EXP_HEADER]: '1730000123000',
          },
        }
      );
    });

    const response = await dispatch(
      env,
      `/api/manage/compound_begin/${VALID_UUID}`,
      'POST',
      VALID_COMPOUND_BEGIN_BODY
    );

    const cookies = getSetCookieHeaders(response);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('zl-compound-commit=compound-token-abc');
    expect(cookies[0]).toContain(`Path=/api/manage/compound_commit/${VALID_UUID}`);
    expect(cookies[1]).toContain(`Path=/api/delete_commit/${VALID_UUID}`);
  });

  it('clears both compound cookie paths from internal commit signals', async () => {
    const { env } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          [INTERNAL_COMMIT_COOKIE_ACTION_HEADER]: 'clear',
          [INTERNAL_COMMIT_COOKIE_KIND_HEADER]: 'compound',
        },
      });
    });

    const response = await dispatch(
      env,
      `/api/delete_commit/${VALID_UUID}`,
      'POST',
      VALID_COMPOUND_COMMIT_DELETE_BODY
    );

    const cookies = getSetCookieHeaders(response);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('zl-compound-commit=');
    expect(cookies[0]).toContain('Max-Age=0');
    expect(cookies[0]).toContain(`Path=/api/manage/compound_commit/${VALID_UUID}`);
    expect(cookies[1]).toContain(`Path=/api/delete_commit/${VALID_UUID}`);
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

  it('forwards softkey compound_commit request to SecretVault DO', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const response = await dispatch(
      env,
      `/api/manage/compound_commit/${VALID_UUID}`,
      'POST',
      VALID_SOFTKEY_COMPOUND_COMMIT_UPDATE_BODY
    );
    const payload = (await response.json()) as { ok: true };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/compound_commit');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toContain('"adminMode":"softkey"');
    expect(calls[0]?.body).toContain('"softkeySignature"');
  });

  it('forwards softkey delete_commit alias to SecretVault compound_commit', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const response = await dispatch(
      env,
      `/api/delete_commit/${VALID_UUID}`,
      'POST',
      VALID_SOFTKEY_COMPOUND_COMMIT_DELETE_BODY
    );
    const payload = (await response.json()) as { ok: true };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/compound_commit');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toContain('"adminMode":"softkey"');
  });

  it('returns 400 for invalid compound_begin payload and does not call DO', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
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
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
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
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
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

  it('returns 405 for method mismatch on compound routes', async () => {
    const { env, calls } = createMockEnv(async () => {
      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
    });

    const response = await dispatch(env, `/api/manage/compound_begin/${VALID_UUID}`, 'GET');
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    expect(payload.code).toBe('METHOD_NOT_ALLOWED');
    expect(calls).toHaveLength(0);
  });

  it('propagates compound/delete error statuses from DO', async () => {
    const scenarios = [
      { status: 409, code: 'VERSION_MISMATCH' },
      { status: 409, code: 'NONCE_REPLAY' },
      { status: 400, code: 'TIMESTAMP_OUT_OF_RANGE' },
      { status: 400, code: 'INTENT_HASH_MISMATCH' },
      { status: 400, code: 'CIPHER_BUNDLE_INVALID' },
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
});
