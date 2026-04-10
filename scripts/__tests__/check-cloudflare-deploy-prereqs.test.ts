import { describe, expect, it, vi } from 'vitest';

import {
  CloudflareApiError,
  type CloudflareApiGet,
  type CloudflareApiRequest,
  resolveDeployEnvironment,
  resolveDeployTarget,
  runCloudflareDeployPreflight,
} from '../check-cloudflare-deploy-prereqs';

function createApiRequestMock(
  implementation: (method: string, path: string, body?: unknown) => Promise<unknown>
): CloudflareApiRequest & { mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(implementation);
  const apiRequest = (async <T>(method: string, path: string, body?: unknown) =>
    mock(method, path, body) as Promise<T>) as CloudflareApiRequest & {
    mock: ReturnType<typeof vi.fn>;
  };
  apiRequest.mock = mock;
  return apiRequest;
}

function createApiGetMock(
  implementation: (path: string) => Promise<unknown>
): CloudflareApiGet & { mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(implementation);
  const apiGet = (async <T>(path: string) => mock(path) as Promise<T>) as CloudflareApiGet & {
    mock: ReturnType<typeof vi.fn>;
  };
  apiGet.mock = mock;
  return apiGet;
}

function createTokenDetails(
  overrides?: Partial<{
    bucketName: string;
    routePermission: string;
    r2Permission: string;
    scriptPermission: string;
    status: string;
  }>
) {
  const bucketName = overrides?.bucketName ?? 'zerolink-files-staging';
  const routePermission = overrides?.routePermission ?? 'Workers Routes Write';
  const r2Permission = overrides?.r2Permission ?? 'Workers R2 Storage Write';
  const scriptPermission = overrides?.scriptPermission ?? 'Workers Scripts Write';
  const status = overrides?.status ?? 'active';

  return {
    id: 'token-123',
    name: 'Deploy token',
    policies: [
      {
        effect: 'allow',
        permission_groups: [{ name: scriptPermission }],
        resources: {
          'com.cloudflare.api.account.account-123': '*',
        },
      },
      {
        effect: 'allow',
        permission_groups: [{ name: routePermission }],
        resources: {
          'com.cloudflare.api.account.account-123': {
            'com.cloudflare.api.account.zone.*': '*',
          },
        },
      },
      {
        effect: 'allow',
        permission_groups: [{ name: r2Permission }],
        resources: {
          'com.cloudflare.api.account.account-123': '*',
        },
      },
      {
        effect: 'allow',
        permission_groups: [{ name: 'Workers R2 Storage Bucket Item Read' }],
        resources: {
          [`com.cloudflare.edge.r2.bucket.account-123_default_${bucketName}`]: '*',
        },
      },
    ],
    status,
  };
}

describe('resolveDeployEnvironment', () => {
  it('defaults to production', () => {
    expect(resolveDeployEnvironment([], {} as NodeJS.ProcessEnv)).toBe('production');
  });

  it('reads --env staging', () => {
    expect(resolveDeployEnvironment(['--env', 'staging'], {} as NodeJS.ProcessEnv)).toBe('staging');
  });

  it('reads ZEROLINK_DEPLOY_ENV when flag is absent', () => {
    expect(
      resolveDeployEnvironment([], {
        ZEROLINK_DEPLOY_ENV: 'staging',
      } as NodeJS.ProcessEnv)
    ).toBe('staging');
  });

  it('rejects unsupported values', () => {
    expect(() => resolveDeployEnvironment(['--env', 'qa'], {} as NodeJS.ProcessEnv)).toThrow(
      'Unsupported deploy environment'
    );
  });
});

describe('resolveDeployTarget', () => {
  it('reads staging bucket and zone from wrangler config', () => {
    expect(
      resolveDeployTarget('staging', {
        wranglerToml: `
name = "custom-worker"

[[r2_buckets]]
binding = "FILE_BUCKET"
bucket_name = "custom-files"

[env.staging]
routes = [
  { pattern = "staging.example.com", zone_name = "example.com" },
  { pattern = "staging.example.com/*", zone_name = "example.com" },
]

[[env.staging.r2_buckets]]
binding = "FILE_BUCKET"
bucket_name = "custom-files-staging"
`,
      })
    ).toEqual({
      bucketName: 'custom-files-staging',
      label: 'staging',
      zoneName: 'example.com',
    });
  });

  it('allows route-less deployments when the target environment has no routes', () => {
    expect(
      resolveDeployTarget('production', {
        wranglerToml: `
name = "custom-worker"

[[r2_buckets]]
binding = "FILE_BUCKET"
bucket_name = "custom-files"
`,
      })
    ).toEqual({
      bucketName: 'custom-files',
      label: 'production',
      zoneName: null,
    });
  });

  it('selects the FILE_BUCKET binding when multiple R2 buckets exist', () => {
    expect(
      resolveDeployTarget('production', {
        wranglerToml: `
name = "custom-worker"

[[r2_buckets]]
binding = "OTHER_BUCKET"
bucket_name = "wrong-bucket"

[[r2_buckets]]
binding = "FILE_BUCKET"
bucket_name = "correct-bucket"
`,
      })
    ).toEqual({
      bucketName: 'correct-bucket',
      label: 'production',
      zoneName: null,
    });
  });
});

describe('runCloudflareDeployPreflight', () => {
  it('verifies the token, permission groups, and bucket in order for a user token', async () => {
    const apiGet = createApiGetMock(async (path) => {
      if (path === '/user/tokens/verify') {
        return { errors: [], result: { id: 'token-123', status: 'active' }, success: true };
      }
      if (path === '/user/tokens/token-123') {
        return { errors: [], result: createTokenDetails(), success: true };
      }
      if (path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      if (path === '/accounts/account-123/r2/buckets/zerolink-files-staging') {
        return { errors: [], result: { name: 'zerolink-files-staging' }, success: true };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    let output = '';
    await runCloudflareDeployPreflight({
      accountId: 'account-123',
      apiGet,
      apiToken: 'token-123',
      deployEnv: 'staging',
      write: (chunk) => {
        output += chunk;
      },
    });

    expect(apiGet.mock.mock.calls.map(([path]) => path)).toEqual([
      '/user/tokens/verify',
      '/user/tokens/token-123',
      '/zones?name=zerolink.dev',
      '/accounts/account-123/r2/buckets/zerolink-files-staging',
    ]);
    expect(output).toContain('Workers Scripts Write');
    expect(output).toContain('Workers Routes Write');
    expect(output).toContain('Workers R2 Storage Write');
    expect(output).toContain('All checks passed');
  });

  it('skips zone and route checks when the environment has no configured routes', async () => {
    const apiGet = createApiGetMock(async (path) => {
      if (path === '/user/tokens/verify') {
        return { errors: [], result: { id: 'token-123', status: 'active' }, success: true };
      }
      if (path === '/user/tokens/token-123') {
        return {
          errors: [],
          result: createTokenDetails({ bucketName: 'custom-files' }),
          success: true,
        };
      }
      if (path === '/accounts/account-123/r2/buckets/custom-files') {
        return { errors: [], result: { name: 'custom-files' }, success: true };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    let output = '';
    await runCloudflareDeployPreflight({
      accountId: 'account-123',
      apiGet,
      apiToken: 'token-123',
      deployEnv: 'production',
      deployTarget: {
        bucketName: 'custom-files',
        label: 'production',
        zoneName: null,
      },
      write: (chunk) => {
        output += chunk;
      },
    });

    expect(apiGet.mock.mock.calls.map(([path]) => path)).toEqual([
      '/user/tokens/verify',
      '/user/tokens/token-123',
      '/accounts/account-123/r2/buckets/custom-files',
    ]);
    expect(output).toContain('Skipping Cloudflare zone resolution');
    expect(output).toContain('Skipping Workers Routes write permission check');
  });

  it('falls back to account-owned token inspection when user token introspection fails', async () => {
    const apiGet = createApiGetMock(async (path) => {
      if (path === '/user/tokens/verify') {
        throw new CloudflareApiError('not a user token', [{ code: 9106, message: 'auth failed' }]);
      }
      if (path === '/accounts/account-123/tokens/verify') {
        return { errors: [], result: { id: 'token-123', status: 'active' }, success: true };
      }
      if (path === '/accounts/account-123/tokens/token-123') {
        return {
          errors: [],
          result: createTokenDetails({ bucketName: 'zerolink-files' }),
          success: true,
        };
      }
      if (path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      if (path === '/accounts/account-123/r2/buckets/zerolink-files') {
        return { errors: [], result: { name: 'zerolink-files' }, success: true };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await runCloudflareDeployPreflight({
      accountId: 'account-123',
      apiGet,
      apiToken: 'token-123',
      deployEnv: 'production',
      write: () => {},
    });

    expect(apiGet.mock.mock.calls.map(([path]) => path)).toEqual([
      '/user/tokens/verify',
      '/accounts/account-123/tokens/verify',
      '/accounts/account-123/tokens/token-123',
      '/zones?name=zerolink.dev',
      '/accounts/account-123/r2/buckets/zerolink-files',
    ]);
  });

  it('falls back to best-effort resource checks when token introspection is unavailable', async () => {
    const apiRequest = createApiRequestMock(async (method, path, body) => {
      if (method === 'GET' && path === '/user/tokens/verify') {
        throw new CloudflareApiError('invalid token for user endpoint', [
          { code: 1000, message: 'Invalid API Token' },
        ]);
      }
      if (method === 'GET' && path === '/accounts/account-123/tokens/verify') {
        throw new CloudflareApiError('token inspection forbidden', [
          { code: 9109, message: 'Unauthorized to access requested resource' },
        ]);
      }
      if (method === 'GET' && path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      if (method === 'GET' && path === '/accounts/account-123/workers/scripts') {
        return { errors: [], result: [{ id: 'zerolink' }], success: true };
      }
      if (method === 'GET' && path === '/zones/zone-123/workers/routes') {
        return {
          errors: [],
          result: [{ id: 'route-123', pattern: 'staging.zerolink.dev/*', script: 'zerolink' }],
          success: true,
        };
      }
      if (method === 'POST' && path === '/accounts/account-123/r2/buckets') {
        expect(body).toEqual({ name: 'A' });
        throw new CloudflareApiError(
          'validation failed',
          [{ code: 10001, message: 'name is required' }],
          400
        );
      }
      if (method === 'GET' && path === '/accounts/account-123/r2/buckets/zerolink-files-staging') {
        return { errors: [], result: { name: 'zerolink-files-staging' }, success: true };
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    let output = '';
    await runCloudflareDeployPreflight({
      accountId: 'account-123',
      apiRequest,
      apiToken: 'token-123',
      deployEnv: 'staging',
      write: (chunk) => {
        output += chunk;
      },
    });

    expect(apiRequest.mock.mock.calls).toEqual([
      ['GET', '/user/tokens/verify', undefined],
      ['GET', '/accounts/account-123/tokens/verify', undefined],
      ['GET', '/zones?name=zerolink.dev', undefined],
      ['GET', '/accounts/account-123/workers/scripts', undefined],
      ['GET', '/zones/zone-123/workers/routes', undefined],
      ['POST', '/accounts/account-123/r2/buckets', { name: 'A' }],
      ['GET', '/accounts/account-123/r2/buckets/zerolink-files-staging', undefined],
    ]);
    expect(output).toContain('WARN  Token introspection is unavailable');
    expect(output).toContain('best-effort resource access checks');
    expect(output).toContain('Best-effort checks passed');
  });

  it('rejects read-only R2 access during the best-effort fallback path', async () => {
    const apiRequest = createApiRequestMock(async (method, path, body) => {
      if (method === 'GET' && path === '/user/tokens/verify') {
        throw new CloudflareApiError('invalid token for user endpoint', [
          { code: 1000, message: 'Invalid API Token' },
        ]);
      }
      if (method === 'GET' && path === '/accounts/account-123/tokens/verify') {
        throw new CloudflareApiError('token inspection forbidden', [
          { code: 9109, message: 'Unauthorized to access requested resource' },
        ]);
      }
      if (method === 'GET' && path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      if (method === 'GET' && path === '/accounts/account-123/workers/scripts') {
        return { errors: [], result: [{ id: 'zerolink' }], success: true };
      }
      if (method === 'GET' && path === '/zones/zone-123/workers/routes') {
        return {
          errors: [],
          result: [{ id: 'route-123', pattern: 'staging.zerolink.dev/*', script: 'zerolink' }],
          success: true,
        };
      }
      if (method === 'POST' && path === '/accounts/account-123/r2/buckets') {
        expect(body).toEqual({ name: 'A' });
        throw new CloudflareApiError(
          'not authorized for write',
          [{ code: 10000, message: 'Authentication error' }],
          403
        );
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    await expect(
      runCloudflareDeployPreflight({
        accountId: 'account-123',
        apiRequest,
        apiToken: 'token-123',
        deployEnv: 'staging',
        write: () => {},
      })
    ).rejects.toThrow('Workers R2 Storage write probe failed');

    expect(apiRequest.mock).not.toHaveBeenCalledWith(
      'GET',
      '/accounts/account-123/r2/buckets/zerolink-files-staging',
      undefined
    );
  });

  it('does not treat unexpected non-auth R2 probe failures as a pass', async () => {
    const apiRequest = createApiRequestMock(async (method, path, body) => {
      if (method === 'GET' && path === '/user/tokens/verify') {
        throw new CloudflareApiError('invalid token for user endpoint', [
          { code: 1000, message: 'Invalid API Token' },
        ]);
      }
      if (method === 'GET' && path === '/accounts/account-123/tokens/verify') {
        throw new CloudflareApiError('token inspection forbidden', [
          { code: 9109, message: 'Unauthorized to access requested resource' },
        ]);
      }
      if (method === 'GET' && path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      if (method === 'GET' && path === '/accounts/account-123/workers/scripts') {
        return { errors: [], result: [{ id: 'zerolink' }], success: true };
      }
      if (method === 'GET' && path === '/zones/zone-123/workers/routes') {
        return {
          errors: [],
          result: [{ id: 'route-123', pattern: 'staging.zerolink.dev/*', script: 'zerolink' }],
          success: true,
        };
      }
      if (method === 'POST' && path === '/accounts/account-123/r2/buckets') {
        expect(body).toEqual({ name: 'A' });
        throw new CloudflareApiError(
          'unexpected upstream failure',
          [{ code: 7003, message: 'No route for the URI' }],
          404
        );
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    await expect(
      runCloudflareDeployPreflight({
        accountId: 'account-123',
        apiRequest,
        apiToken: 'token-123',
        deployEnv: 'staging',
        write: () => {},
      })
    ).rejects.toThrow('Workers R2 Storage write probe failed');

    expect(apiRequest.mock).not.toHaveBeenCalledWith(
      'GET',
      '/accounts/account-123/r2/buckets/zerolink-files-staging',
      undefined
    );
  });

  it('does not fall back on unexpected token introspection errors', async () => {
    const apiGet = createApiGetMock(async (path) => {
      if (path === '/user/tokens/verify') {
        throw new Error('socket hang up');
      }
      if (path === '/accounts/account-123/tokens/verify') {
        throw new CloudflareApiError('token inspection forbidden', [
          { code: 9109, message: 'Unauthorized to access requested resource' },
        ]);
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await expect(
      runCloudflareDeployPreflight({
        accountId: 'account-123',
        apiGet,
        apiToken: 'token-123',
        deployEnv: 'staging',
        write: () => {},
      })
    ).rejects.toThrow('Unable to inspect the current Cloudflare API token');

    expect(apiGet.mock).not.toHaveBeenCalledWith('/accounts/account-123/workers/scripts');
  });

  it('rejects read-only Workers Scripts permission groups', async () => {
    const apiGet = createApiGetMock(async (path) => {
      if (path === '/user/tokens/verify') {
        return { errors: [], result: { id: 'token-123', status: 'active' }, success: true };
      }
      if (path === '/user/tokens/token-123') {
        return {
          errors: [],
          result: createTokenDetails({ scriptPermission: 'Workers Scripts Read' }),
          success: true,
        };
      }
      if (path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await expect(
      runCloudflareDeployPreflight({
        accountId: 'account-123',
        apiGet,
        apiToken: 'token-123',
        deployEnv: 'staging',
        write: () => {},
      })
    ).rejects.toThrow('Workers Scripts Write');
    expect(apiGet.mock).not.toHaveBeenCalledWith(
      '/accounts/account-123/r2/buckets/zerolink-files-staging'
    );
  });

  it('rejects read-only R2 permission groups before bucket lookup', async () => {
    const apiGet = createApiGetMock(async (path) => {
      if (path === '/user/tokens/verify') {
        return { errors: [], result: { id: 'token-123', status: 'active' }, success: true };
      }
      if (path === '/user/tokens/token-123') {
        return {
          errors: [],
          result: createTokenDetails({ r2Permission: 'Workers R2 Storage Read' }),
          success: true,
        };
      }
      if (path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await expect(
      runCloudflareDeployPreflight({
        accountId: 'account-123',
        apiGet,
        apiToken: 'token-123',
        deployEnv: 'staging',
        write: () => {},
      })
    ).rejects.toThrow('Workers R2 Storage Write');
    expect(apiGet.mock).not.toHaveBeenCalledWith(
      '/accounts/account-123/r2/buckets/zerolink-files-staging'
    );
  });

  it('surfaces a clear bucket creation hint when the R2 bucket is missing', async () => {
    const apiGet = createApiGetMock(async (path) => {
      if (path === '/user/tokens/verify') {
        return { errors: [], result: { id: 'token-123', status: 'active' }, success: true };
      }
      if (path === '/user/tokens/token-123') {
        return {
          errors: [],
          result: createTokenDetails({ bucketName: 'zerolink-files' }),
          success: true,
        };
      }
      if (path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      if (path === '/accounts/account-123/r2/buckets/zerolink-files') {
        throw new CloudflareApiError('missing bucket', [
          { code: 10006, message: 'missing bucket' },
        ]);
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await expect(
      runCloudflareDeployPreflight({
        accountId: 'account-123',
        apiGet,
        apiToken: 'token-123',
        deployEnv: 'production',
        write: () => {},
      })
    ).rejects.toThrow('npx wrangler r2 bucket create zerolink-files');
  });

  it('treats deny policies as blocking even when allow policies are present', async () => {
    const deniedDetails = createTokenDetails();
    deniedDetails.policies?.push({
      effect: 'deny',
      permission_groups: [{ name: 'Workers Routes Write' }],
      resources: {
        'com.cloudflare.api.account.zone.zone-123': '*',
      },
    });

    const apiGet = createApiGetMock(async (path) => {
      if (path === '/user/tokens/verify') {
        return { errors: [], result: { id: 'token-123', status: 'active' }, success: true };
      }
      if (path === '/user/tokens/token-123') {
        return { errors: [], result: deniedDetails, success: true };
      }
      if (path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await expect(
      runCloudflareDeployPreflight({
        accountId: 'account-123',
        apiGet,
        apiToken: 'token-123',
        deployEnv: 'staging',
        write: () => {},
      })
    ).rejects.toThrow('explicitly denied');
  });
});
