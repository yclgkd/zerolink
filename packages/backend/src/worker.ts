import {
  CompoundBeginRequestSchema,
  CompoundCommitRequestSchema,
  CreateBeginRequestSchema,
  CreateFinishRequestSchema,
  LockBeginRequestSchema,
  LockCommitRequestSchema,
  SoftkeyCompoundCommitRequestSchema,
} from '@zerolink/shared';

export interface Env {
  SECRET_VAULT: DurableObjectNamespace;
  SECRETS_KV: KVNamespace;
  APP_ENV: string;
  RP_ID: string;
  RP_ORIGIN: string;
}

const UUID_REGEX = /^[A-Za-z0-9_-]{21}$/u;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

type ApiMethod = 'GET' | 'POST';

interface ApiRoute {
  method: ApiMethod;
  pattern: RegExp;
}

const API_PREFIX = '/api';
const ALLOW_METHODS = 'GET,POST,OPTIONS';
const ALLOW_HEADERS = 'Content-Type, Authorization';
const CORS_ALLOW_ORIGIN = '*';
const LOCK_BEGIN_PATH = /^\/api\/lock_begin\/([^/]+)$/u;
const LOCK_COMMIT_PATH = /^\/api\/lock_commit\/([^/]+)$/u;
const COMPOUND_BEGIN_PATH = /^\/api\/manage\/compound_begin\/([^/]+)$/u;
const COMPOUND_COMMIT_PATH = /^\/api\/manage\/compound_commit\/([^/]+)$/u;
const DELETE_COMMIT_PATH = /^\/api\/delete_commit\/([^/]+)$/u;
const PUBLIC_STATUS_PATH = /^\/api\/public\/([^/]+)$/u;
const DECRYPT_FETCH_PATH = /^\/api\/decrypt_fetch\/([^/]+)$/u;
const WS_SUBSCRIBE_PATH = /^\/api\/ws\/([^/]+)$/u;

const API_ROUTES: readonly ApiRoute[] = [
  { method: 'POST', pattern: /^\/api\/create_begin\/[^/]+$/u },
  { method: 'POST', pattern: /^\/api\/create_finish\/[^/]+$/u },
];

function isApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

function buildApiHeaders(): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': CORS_ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
  });
}

function jsonApiResponse(
  payload: Record<string, unknown>,
  status: number,
  headers?: Headers
): Response {
  const resolvedHeaders = headers ?? buildApiHeaders();
  resolvedHeaders.set('Content-Type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(payload), {
    status,
    headers: resolvedHeaders,
  });
}

function errorResponse(code: string, status: number, headers?: Headers): Response {
  return jsonApiResponse(
    {
      ok: false,
      code,
    },
    status,
    headers
  );
}

function notImplemented(): Response {
  return errorResponse('NOT_IMPLEMENTED', 501);
}

function notFound(): Response {
  return errorResponse('NOT_FOUND', 404);
}

function methodNotAllowed(allowedMethod: ApiMethod): Response {
  const headers = buildApiHeaders();
  headers.set('Allow', `${allowedMethod}, OPTIONS`);

  return errorResponse('METHOD_NOT_ALLOWED', 405, headers);
}

function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: buildApiHeaders(),
  });
}

async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function toJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

async function forwardToSecretVault(
  env: Env,
  uuid: string,
  path:
    | '/lock_begin'
    | '/lock_commit'
    | '/compound_begin'
    | '/compound_commit'
    | '/create_begin'
    | '/create_finish'
    | '/get_public_state'
    | '/get_decrypt_payload',
  payload: Record<string, unknown>
): Promise<Response> {
  try {
    const durableObjectId = env.SECRET_VAULT.idFromName(uuid);
    const stub = env.SECRET_VAULT.get(durableObjectId);
    const vaultResponse = await stub.fetch(`https://secret-vault.internal${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
    const bodyText = await vaultResponse.text();
    const body = bodyText.length > 0 ? JSON.parse(bodyText) : {};
    const jsonBody = toJsonObject(body);

    if (!jsonBody) {
      return errorResponse('INTERNAL_ERROR', 500);
    }

    const responseHeaders = buildApiHeaders();
    const retryAfter = vaultResponse.headers.get('Retry-After');
    if (retryAfter) {
      responseHeaders.set('Retry-After', retryAfter);
    }

    return jsonApiResponse(jsonBody, vaultResponse.status, responseHeaders);
  } catch {
    return errorResponse('INTERNAL_ERROR', 500);
  }
}

async function handleLockBegin(
  request: Request,
  env: Env,
  pathnameUuid: string
): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const parsed = LockBeginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('BAD_REQUEST', 400);
  }

  if (parsed.data.uuid !== pathnameUuid) {
    return errorResponse('BAD_REQUEST', 400);
  }

  return forwardToSecretVault(env, pathnameUuid, '/lock_begin', parsed.data);
}

async function handleLockCommit(
  request: Request,
  env: Env,
  pathnameUuid: string
): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const parsed = LockCommitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('BAD_REQUEST', 400);
  }

  if (parsed.data.uuid !== pathnameUuid) {
    return errorResponse('BAD_REQUEST', 400);
  }

  return forwardToSecretVault(env, pathnameUuid, '/lock_commit', parsed.data);
}

async function handleCreateBegin(
  request: Request,
  env: Env,
  pathnameUuid: string
): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const parsed = CreateBeginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('BAD_REQUEST', 400);
  }

  if (parsed.data.uuid !== pathnameUuid) {
    return errorResponse('BAD_REQUEST', 400);
  }

  return forwardToSecretVault(env, pathnameUuid, '/create_begin', parsed.data);
}

async function handleCreateFinish(
  request: Request,
  env: Env,
  pathnameUuid: string
): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const parsed = CreateFinishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('BAD_REQUEST', 400);
  }

  if (parsed.data.uuid !== pathnameUuid) {
    return errorResponse('BAD_REQUEST', 400);
  }

  return forwardToSecretVault(env, pathnameUuid, '/create_finish', parsed.data);
}

async function handleCompoundBegin(
  request: Request,
  env: Env,
  pathnameUuid: string
): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const parsed = CompoundBeginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('BAD_REQUEST', 400);
  }

  if (parsed.data.uuid !== pathnameUuid) {
    return errorResponse('BAD_REQUEST', 400);
  }

  return forwardToSecretVault(env, pathnameUuid, '/compound_begin', parsed.data);
}

async function handleCompoundCommit(
  request: Request,
  env: Env,
  pathnameUuid: string,
  deleteOnly: boolean
): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const parsedWebAuthn = CompoundCommitRequestSchema.safeParse(body);
  const parsedSoftkey = SoftkeyCompoundCommitRequestSchema.safeParse(body);
  const parsedData = parsedSoftkey.success
    ? parsedSoftkey.data
    : parsedWebAuthn.success
      ? parsedWebAuthn.data
      : null;
  if (!parsedData) {
    return errorResponse('BAD_REQUEST', 400);
  }

  if (parsedData.uuid !== pathnameUuid || parsedData.intent.uuid !== pathnameUuid) {
    return errorResponse('BAD_REQUEST', 400);
  }

  if (deleteOnly && parsedData.intent.op !== 'delete') {
    return errorResponse('BAD_REQUEST', 400);
  }

  return forwardToSecretVault(env, pathnameUuid, '/compound_commit', parsedData);
}

async function forwardWebSocketUpgrade(
  env: Env,
  uuid: string,
  request: Request
): Promise<Response> {
  const durableObjectId = env.SECRET_VAULT.idFromName(uuid);
  const stub = env.SECRET_VAULT.get(durableObjectId);
  return stub.fetch('https://secret-vault.internal/ws', {
    headers: request.headers,
  });
}

async function handleApiRequest(request: Request, pathname: string, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return preflight();
  }

  const wsMatch = pathname.match(WS_SUBSCRIBE_PATH);
  if (wsMatch) {
    const uuid = wsMatch[1] ?? '';
    if (!isValidUuid(uuid)) return errorResponse('BAD_REQUEST', 400);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return errorResponse('BAD_REQUEST', 426);
    }
    return forwardWebSocketUpgrade(env, uuid, request);
  }

  const lockBeginMatch = pathname.match(LOCK_BEGIN_PATH);
  if (lockBeginMatch) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const uuid = lockBeginMatch[1] ?? '';
    if (!isValidUuid(uuid)) return errorResponse('BAD_REQUEST', 400);
    return handleLockBegin(request, env, uuid);
  }

  const lockCommitMatch = pathname.match(LOCK_COMMIT_PATH);
  if (lockCommitMatch) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const uuid = lockCommitMatch[1] ?? '';
    if (!isValidUuid(uuid)) return errorResponse('BAD_REQUEST', 400);
    return handleLockCommit(request, env, uuid);
  }

  const compoundBeginMatch = pathname.match(COMPOUND_BEGIN_PATH);
  if (compoundBeginMatch) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const uuid = compoundBeginMatch[1] ?? '';
    if (!isValidUuid(uuid)) return errorResponse('BAD_REQUEST', 400);
    return handleCompoundBegin(request, env, uuid);
  }

  const compoundCommitMatch = pathname.match(COMPOUND_COMMIT_PATH);
  if (compoundCommitMatch) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const uuid = compoundCommitMatch[1] ?? '';
    if (!isValidUuid(uuid)) return errorResponse('BAD_REQUEST', 400);
    return handleCompoundCommit(request, env, uuid, false);
  }

  const createBeginMatch = pathname.match(/^\/api\/create_begin\/([^/]+)$/u);
  if (createBeginMatch) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const uuid = createBeginMatch[1] ?? '';
    if (!isValidUuid(uuid)) return errorResponse('BAD_REQUEST', 400);
    return handleCreateBegin(request, env, uuid);
  }

  const createFinishMatch = pathname.match(/^\/api\/create_finish\/([^/]+)$/u);
  if (createFinishMatch) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const uuid = createFinishMatch[1] ?? '';
    if (!isValidUuid(uuid)) return errorResponse('BAD_REQUEST', 400);
    return handleCreateFinish(request, env, uuid);
  }

  const deleteCommitMatch = pathname.match(DELETE_COMMIT_PATH);
  if (deleteCommitMatch) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const uuid = deleteCommitMatch[1] ?? '';
    if (!isValidUuid(uuid)) return errorResponse('BAD_REQUEST', 400);
    return handleCompoundCommit(request, env, uuid, true);
  }

  const publicStatusMatch = pathname.match(PUBLIC_STATUS_PATH);
  if (publicStatusMatch) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const uuid = publicStatusMatch[1] ?? '';
    if (!isValidUuid(uuid)) return errorResponse('BAD_REQUEST', 400);
    return forwardToSecretVault(env, uuid, '/get_public_state', {});
  }

  const decryptFetchMatch = pathname.match(DECRYPT_FETCH_PATH);
  if (decryptFetchMatch) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const uuid = decryptFetchMatch[1] ?? '';
    if (!isValidUuid(uuid)) return errorResponse('BAD_REQUEST', 400);
    return forwardToSecretVault(env, uuid, '/get_decrypt_payload', {});
  }

  const route = API_ROUTES.find((candidate) => candidate.pattern.test(pathname));
  if (!route) {
    return notFound();
  }

  if (route.method !== request.method) {
    return methodNotAllowed(route.method);
  }

  return notImplemented();
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (!isApiPath(url.pathname)) {
        return new Response('ZeroLink API', { status: 200 });
      }

      return await handleApiRequest(request, url.pathname, env);
    } catch {
      return errorResponse('INTERNAL_ERROR', 500);
    }
  },
};

export default worker;
