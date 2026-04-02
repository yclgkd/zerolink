import { describe, expect, it, vi } from 'vitest';

import {
  CloudflareApiError,
  type CloudflareApiGet,
  resolveDeployEnvironment,
  resolveDeployTarget,
  runCloudflareDeployPreflight,
} from '../check-cloudflare-deploy-prereqs';

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
  it('maps staging to the staging bucket and zone', () => {
    expect(resolveDeployTarget('staging')).toEqual({
      bucketName: 'zerolink-files-staging',
      label: 'staging',
      zoneName: 'zerolink.dev',
    });
  });
});

describe('runCloudflareDeployPreflight', () => {
  it('checks Workers, zone routes, and the environment bucket in order', async () => {
    const apiGet = createApiGetMock(async (path) => {
      if (path === '/accounts/account-123/workers/scripts') {
        return { errors: [], result: [], success: true };
      }
      if (path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      if (path === '/zones/zone-123/workers/routes') {
        return { errors: [], result: [], success: true };
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
      '/accounts/account-123/workers/scripts',
      '/zones?name=zerolink.dev',
      '/zones/zone-123/workers/routes',
      '/accounts/account-123/r2/buckets/zerolink-files-staging',
    ]);
    expect(output).toContain('All checks passed');
  });

  it('surfaces a clear bucket creation hint when the R2 bucket is missing', async () => {
    const apiGet = createApiGetMock(async (path) => {
      if (path === '/accounts/account-123/workers/scripts') {
        return { errors: [], result: [], success: true };
      }
      if (path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      if (path === '/zones/zone-123/workers/routes') {
        return { errors: [], result: [], success: true };
      }
      throw new CloudflareApiError('missing bucket', [{ code: 10006, message: 'missing bucket' }]);
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

  it('surfaces route permission failures before bucket checks', async () => {
    const apiGet = createApiGetMock(async (path) => {
      if (path === '/accounts/account-123/workers/scripts') {
        return { errors: [], result: [], success: true };
      }
      if (path === '/zones?name=zerolink.dev') {
        return {
          errors: [],
          result: [{ id: 'zone-123', name: 'zerolink.dev' }],
          success: true,
        };
      }
      if (path === '/zones/zone-123/workers/routes') {
        throw new CloudflareApiError('auth failed', [{ code: 10000, message: 'auth failed' }]);
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
    ).rejects.toThrow('Workers Routes access check failed');
    expect(apiGet.mock).not.toHaveBeenCalledWith('/accounts/account-123/r2/buckets/zerolink-files');
  });
});
