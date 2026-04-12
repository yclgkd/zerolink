import type { Base64Url } from '@zerolink/shared';
import { createMockState, RP_ID, RP_ORIGIN } from '../../do/__tests__/helpers/vault-fixtures.ts';
import { SecretVault } from '../../do/SecretVault.ts';
import type { Env } from '../../index.ts';
import { createMockR2Bucket } from './r2-fixtures.ts';
import { dispatch, getSetCookieHeaders } from './worker-fixtures.ts';

interface DurableObjectHarness {
  state: DurableObjectState;
  snapshot: Map<string, unknown>;
  vault: SecretVault;
}

export interface WorkerProtocolHarness {
  env: Env;
  dispatch(
    path: string,
    method: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<Response>;
  getVault(uuid: string): DurableObjectHarness;
}

function requestFromInput(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) {
    return input;
  }

  return new Request(typeof input === 'string' ? input : input.toString(), init);
}

export function createWorkerProtocolHarness(): WorkerProtocolHarness {
  const vaults = new Map<string, DurableObjectHarness>();
  const fileBucket = createMockR2Bucket();

  const namespace = {
    idFromName(name: string): DurableObjectId {
      return { toString: () => name } as DurableObjectId;
    },
    get(id: DurableObjectId): DurableObjectStub {
      const uuid = id.toString();

      return {
        async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
          return getVault(uuid).vault.fetch(requestFromInput(input, init));
        },
      } as DurableObjectStub;
    },
  } as DurableObjectNamespace;

  function getVault(uuid: string): DurableObjectHarness {
    const existing = vaults.get(uuid);
    if (existing) {
      return existing;
    }

    const { state, snapshot } = createMockState();
    const vault = new SecretVault(state, {
      SECRET_VAULT: namespace,
      APP_ENV: 'test',
      COMMIT_TOKEN_SECRET: 'commit-token-secret',
      RP_ID,
      RP_ORIGIN,
      FILE_BUCKET: fileBucket,
    });
    const created = { state, snapshot, vault };
    vaults.set(uuid, created);
    return created;
  }

  const env: Env = {
    SECRET_VAULT: namespace,
    ASSETS: {
      async fetch(_request: Request): Promise<Response> {
        return new Response('<html>ZeroLink</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      },
    } as Fetcher,
    FILE_BUCKET: fileBucket,
    APP_ENV: 'test',
    COMMIT_TOKEN_SECRET: 'commit-token-secret',
    RP_ID,
    RP_ORIGIN,
  };

  return {
    env,
    dispatch(path, method, body, extraHeaders) {
      return dispatch(env, path, method, body, false, extraHeaders);
    },
    getVault,
  };
}

export function getCookieHeader(response: Response, cookieName: string): string | null {
  for (const cookie of getSetCookieHeaders(response)) {
    const [pair] = cookie.split(';', 1);
    if (!pair) {
      continue;
    }
    const separator = pair.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (name === cookieName) {
      return `${name}=${value}`;
    }
  }

  return null;
}

export function asCallerHeaders(cookieHeader?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'CF-Connecting-IP': '198.51.100.42',
    'User-Agent': 'ProtocolRegression/1.0',
  };

  if (cookieHeader) {
    // biome-ignore lint/complexity/useLiteralKeys: HeadersInit uses the canonical Cookie casing.
    headers['Cookie'] = cookieHeader;
  }

  return headers;
}

export function asBase64Url(value: string): Base64Url {
  return value as Base64Url;
}
