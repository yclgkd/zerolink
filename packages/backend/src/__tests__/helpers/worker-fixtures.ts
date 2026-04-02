import {
  computeCallerKey,
  INTERNAL_CALLER_KEY_HEADER,
  INTERNAL_COMMIT_COOKIE_ACTION_HEADER,
  INTERNAL_COMMIT_COOKIE_EXP_HEADER,
  INTERNAL_COMMIT_COOKIE_KIND_HEADER,
  INTERNAL_COMMIT_COOKIE_TOKEN_HEADER,
  INTERNAL_COMMIT_TOKEN_HEADER,
} from '../../commitTokens.ts';
import worker, { type Env } from '../../index.ts';
import { createMockR2Bucket } from './r2-fixtures.ts';

export {
  computeCallerKey,
  INTERNAL_CALLER_KEY_HEADER,
  INTERNAL_COMMIT_COOKIE_ACTION_HEADER,
  INTERNAL_COMMIT_COOKIE_EXP_HEADER,
  INTERNAL_COMMIT_COOKIE_KIND_HEADER,
  INTERNAL_COMMIT_COOKIE_TOKEN_HEADER,
  INTERNAL_COMMIT_TOKEN_HEADER,
};

export type { Env };

export interface ApiErrorResponse {
  ok: false;
  code: string;
}

export interface VaultCall {
  pathname: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
}

export const ctx = {
  passThroughOnException(): void {},
  waitUntil(_promise: Promise<unknown>): void {},
} as ExecutionContext;

export const VALID_UUID = 'abcdefghijklmnopqrstu';
export const OTHER_UUID = 'zzzzzzzzzzzzzzzzzzzzz';

export const VALID_LOCK_COMMIT_BODY = {
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

export const VALID_COMPOUND_BEGIN_BODY = {
  uuid: VALID_UUID,
} as const;

export const VALID_ASSERTION = {
  id: 'credential_id',
  rawId: 'credential_id',
  type: 'public-key',
  response: {
    clientDataJSON: 'client_data',
    authenticatorData: 'auth_data',
    signature: 'signature_data',
  },
} as const;

export const VALID_ATTESTATION = {
  id: 'credential_id',
  rawId: 'credential_id',
  type: 'public-key',
  response: {
    clientDataJSON: 'client_data',
    attestationObject: 'attestation_data',
  },
} as const;

export const VALID_UPDATE_INTENT = {
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

export const VALID_DELETE_INTENT = {
  op: 'delete',
  uuid: VALID_UUID,
  version: 1,
  timestamp: 1_730_000_100_000,
  nonce: 'nonce_delete',
} as const;

export const VALID_COMPOUND_COMMIT_UPDATE_BODY = {
  uuid: VALID_UUID,
  assertion: VALID_ASSERTION,
  intentHash: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  intent: VALID_UPDATE_INTENT,
} as const;

export const VALID_COMPOUND_COMMIT_DELETE_BODY = {
  uuid: VALID_UUID,
  assertion: VALID_ASSERTION,
  intentHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  intent: VALID_DELETE_INTENT,
} as const;

export const VALID_SOFTKEY_COMPOUND_COMMIT_UPDATE_BODY = {
  adminMode: 'softkey',
  uuid: VALID_UUID,
  softkeySignature:
    'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef',
  intentHash: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  intent: VALID_UPDATE_INTENT,
} as const;

export const VALID_SOFTKEY_COMPOUND_COMMIT_DELETE_BODY = {
  adminMode: 'softkey',
  uuid: VALID_UUID,
  softkeySignature:
    'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef',
  intentHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  intent: VALID_DELETE_INTENT,
} as const;

export function createMockEnv(responder: (request: Request) => Promise<Response> | Response): {
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
        headers: Object.fromEntries(request.headers.entries()),
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

  const fileBucket = createMockR2Bucket();
  const assets = {
    async fetch(_request: Request): Promise<Response> {
      return new Response('<html>ZeroLink</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    },
  } as unknown as Fetcher;

  return {
    env: {
      SECRET_VAULT: namespace,
      ASSETS: assets,
      FILE_BUCKET: fileBucket,
      APP_ENV: 'test',
      COMMIT_TOKEN_SECRET: 'commit-token-secret',
      RP_ID: 'zerolink.test',
      RP_ORIGIN: 'https://zerolink.test',
    },
    calls,
  };
}

export function getSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const single = response.headers.get('Set-Cookie');
  return single ? [single] : [];
}

export async function dispatch(
  env: Env,
  path: string,
  method: string,
  body?: unknown,
  rawBody: boolean = false,
  extraHeaders?: Record<string, string>
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

  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }

  const request =
    body === undefined
      ? new Request(`https://zerolink.test${path}`, { method, headers })
      : new Request(`https://zerolink.test${path}`, {
          method,
          headers,
          body: rawBody ? String(body) : JSON.stringify(body),
        });

  return invoke(request, env, ctx);
}

export async function dispatchScheduled(
  env: Env,
  scheduledTime: number = Date.now()
): Promise<void> {
  const scheduledHandler = worker.scheduled;
  if (!scheduledHandler) {
    throw new Error('worker scheduled handler is missing');
  }

  const pending: Promise<unknown>[] = [];
  const scheduledCtx = {
    passThroughOnException(): void {},
    waitUntil(promise: Promise<unknown>): void {
      pending.push(promise);
    },
  } as ExecutionContext;

  await scheduledHandler(
    {
      cron: '0 * * * *',
      scheduledTime,
      type: 'scheduled',
      noRetry(): void {},
    } as unknown as ScheduledController,
    env,
    scheduledCtx
  );

  await Promise.all(pending);
}
