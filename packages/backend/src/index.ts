export interface Env {
  SECRET_VAULT: DurableObjectNamespace;
  SECRETS_KV: KVNamespace;
}

type ApiMethod = 'GET' | 'POST';

interface ApiRoute {
  method: ApiMethod;
  pattern: RegExp;
}

interface ErrorResponse {
  ok: false;
  code: 'NOT_IMPLEMENTED' | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED';
}

const API_PREFIX = '/api';
const ALLOW_METHODS = 'GET,POST,OPTIONS';
const ALLOW_HEADERS = 'Content-Type, Authorization';
const CORS_ALLOW_ORIGIN = '*';

const API_ROUTES: readonly ApiRoute[] = [
  { method: 'GET', pattern: /^\/api\/public\/[^/]+$/u },
  { method: 'POST', pattern: /^\/api\/create_begin\/[^/]+$/u },
  { method: 'POST', pattern: /^\/api\/create_finish\/[^/]+$/u },
  { method: 'POST', pattern: /^\/api\/lock_begin\/[^/]+$/u },
  { method: 'POST', pattern: /^\/api\/lock_commit\/[^/]+$/u },
  { method: 'POST', pattern: /^\/api\/manage\/compound_begin\/[^/]+$/u },
  { method: 'POST', pattern: /^\/api\/manage\/compound_commit\/[^/]+$/u },
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

function jsonApiResponse(payload: ErrorResponse, status: number, headers?: Headers): Response {
  const resolvedHeaders = headers ?? buildApiHeaders();
  resolvedHeaders.set('Content-Type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(payload), {
    status,
    headers: resolvedHeaders,
  });
}

function notImplemented(): Response {
  return jsonApiResponse(
    {
      ok: false,
      code: 'NOT_IMPLEMENTED',
    },
    501
  );
}

function notFound(): Response {
  return jsonApiResponse(
    {
      ok: false,
      code: 'NOT_FOUND',
    },
    404
  );
}

function methodNotAllowed(allowedMethod: ApiMethod): Response {
  const headers = buildApiHeaders();
  headers.set('Allow', `${allowedMethod}, OPTIONS`);

  return jsonApiResponse(
    {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
    },
    405,
    headers
  );
}

function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: buildApiHeaders(),
  });
}

function handleApiRequest(request: Request, pathname: string): Response {
  if (request.method === 'OPTIONS') {
    return preflight();
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
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!isApiPath(url.pathname)) {
      return new Response('ZeroLink API', { status: 200 });
    }

    return handleApiRequest(request, url.pathname);
  },
};

export { SecretVault } from './do/SecretVault.ts';
export default worker;
