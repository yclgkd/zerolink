import { request as httpsRequest } from 'node:https';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export type DeployEnvironment = 'production' | 'staging';

interface DeployTarget {
  bucketName: string;
  label: DeployEnvironment;
  zoneName: string;
}

interface CloudflareApiErrorDetail {
  code?: number;
  message?: string;
}

interface CloudflareApiEnvelope<T> {
  errors?: CloudflareApiErrorDetail[];
  result: T;
  success: boolean;
}

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    readonly errors: CloudflareApiErrorDetail[] = [],
    readonly statusCode: number | null = null
  ) {
    super(message);
    this.name = 'CloudflareApiError';
  }
}

export type CloudflareApiGet = <T>(path: string) => Promise<CloudflareApiEnvelope<T>>;

export interface CloudflareDeployPreflightOptions {
  accountId: string;
  apiGet?: CloudflareApiGet;
  apiToken: string;
  deployEnv: DeployEnvironment;
  write?: (chunk: string) => void;
}

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const DEPLOY_TARGETS: Record<DeployEnvironment, DeployTarget> = {
  production: {
    bucketName: 'zerolink-files',
    label: 'production',
    zoneName: 'zerolink.dev',
  },
  staging: {
    bucketName: 'zerolink-files-staging',
    label: 'staging',
    zoneName: 'zerolink.dev',
  },
};

function out(write: (chunk: string) => void, line: string): void {
  write(`${line}\n`);
}

function getApiErrorCode(error: unknown): number | null {
  if (!(error instanceof CloudflareApiError)) {
    return null;
  }
  return error.errors.find((item) => typeof item.code === 'number')?.code ?? null;
}

function describeApiError(error: unknown): string {
  if (!(error instanceof CloudflareApiError)) {
    return error instanceof Error ? error.message : 'unknown error';
  }

  const details = error.errors
    .map((item) => {
      const code = typeof item.code === 'number' ? `[code: ${item.code}] ` : '';
      return `${code}${item.message ?? 'unknown Cloudflare API error'}`;
    })
    .join('; ');

  if (details.length > 0) {
    return details;
  }

  if (error.statusCode) {
    return `HTTP ${error.statusCode}`;
  }

  return error.message;
}

function createCloudflareApiGet(accountId: string, apiToken: string): CloudflareApiGet {
  return async function apiGet<T>(path: string): Promise<CloudflareApiEnvelope<T>> {
    const body = await requestJson(path, apiToken);

    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      throw new CloudflareApiError(`Cloudflare API returned invalid JSON for ${path}`);
    }

    if (!isCloudflareEnvelope<T>(parsed)) {
      throw new CloudflareApiError(`Cloudflare API returned an unexpected response for ${path}`);
    }

    if (!parsed.success) {
      throw new CloudflareApiError(
        `Cloudflare API request failed for ${path} on account ${accountId}`,
        parsed.errors ?? []
      );
    }

    return parsed;
  };
}

function isCloudflareEnvelope<T>(value: unknown): value is CloudflareApiEnvelope<T> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CloudflareApiEnvelope<T>>;
  return typeof candidate.success === 'boolean' && 'result' in candidate;
}

function requestJson(path: string, apiToken: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        hostname: 'api.cloudflare.com',
        method: 'GET',
        path: `/client/v4${path}`,
      },
      (res) => {
        res.setEncoding('utf8');

        let body = '';
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;
          if (statusCode >= 200 && statusCode < 300) {
            resolve(body);
            return;
          }

          try {
            const parsed = JSON.parse(body) as Partial<CloudflareApiEnvelope<unknown>>;
            reject(
              new CloudflareApiError(
                `Cloudflare API request failed for ${path}`,
                Array.isArray(parsed.errors) ? parsed.errors : [],
                statusCode
              )
            );
          } catch {
            reject(
              new CloudflareApiError(
                `Cloudflare API request failed for ${path} with HTTP ${statusCode}`,
                [],
                statusCode
              )
            );
          }
        });
      }
    );

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

export function resolveDeployEnvironment(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): DeployEnvironment {
  const flagIndex = argv.indexOf('--env');
  const flagValue =
    flagIndex >= 0 ? argv[flagIndex + 1] : argv.find((arg) => arg.startsWith('--env='))?.slice(6);
  const { ZEROLINK_DEPLOY_ENV: deployEnvFromProcess } = env;
  const candidate = (flagValue ?? deployEnvFromProcess ?? 'production').trim();

  if (candidate === 'production' || candidate === 'staging') {
    return candidate;
  }

  throw new Error(`Unsupported deploy environment "${candidate}". Use "production" or "staging".`);
}

export function resolveDeployTarget(deployEnv: DeployEnvironment): DeployTarget {
  return DEPLOY_TARGETS[deployEnv];
}

async function verifyWorkersScriptsAccess(
  accountId: string,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<void> {
  out(write, '[1/4] Checking Workers API access...');

  try {
    await apiGet<unknown[]>(`/accounts/${accountId}/workers/scripts`);
  } catch (error) {
    throw new Error(
      `Workers API access check failed. Ensure CLOUDFLARE_API_TOKEN grants account-level Workers Scripts access. Details: ${describeApiError(error)}`
    );
  }

  out(write, 'PASS  Workers Scripts API is reachable.');
}

async function resolveZoneId(
  zoneName: string,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<string> {
  out(write, '[2/4] Resolving Cloudflare zone...');

  let envelope: CloudflareApiEnvelope<Array<{ id?: string; name?: string }>>;
  try {
    const params = new URLSearchParams({ name: zoneName });
    envelope = await apiGet<Array<{ id?: string; name?: string }>>(`/zones?${params.toString()}`);
  } catch (error) {
    throw new Error(
      `Zone lookup failed for "${zoneName}". Ensure the deploy token can read the target zone. Details: ${describeApiError(error)}`
    );
  }

  const zone = envelope.result.find(
    (item) => item.name === zoneName && typeof item.id === 'string'
  );
  if (!zone?.id) {
    throw new Error(
      `Zone lookup failed for "${zoneName}". Cloudflare did not return a matching zone for this token/account.`
    );
  }

  out(write, `PASS  Resolved zone "${zoneName}".`);
  return zone.id;
}

async function verifyWorkersRoutesAccess(
  zoneId: string,
  zoneName: string,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<void> {
  out(write, '[3/4] Checking Workers Routes access...');

  try {
    await apiGet<unknown[]>(`/zones/${zoneId}/workers/routes`);
  } catch (error) {
    throw new Error(
      `Workers Routes access check failed for "${zoneName}". Ensure CLOUDFLARE_API_TOKEN grants zone-level Workers Routes access. Details: ${describeApiError(error)}`
    );
  }

  out(write, `PASS  Workers Routes API is reachable for "${zoneName}".`);
}

async function verifyBucketAccess(
  accountId: string,
  bucketName: string,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<void> {
  out(write, '[4/4] Checking R2 bucket access...');

  try {
    await apiGet(`/accounts/${accountId}/r2/buckets/${bucketName}`);
  } catch (error) {
    if (getApiErrorCode(error) === 10006) {
      throw new Error(
        `Required R2 bucket "${bucketName}" does not exist. Create it first with: npx wrangler r2 bucket create ${bucketName}`
      );
    }

    throw new Error(
      `R2 bucket access check failed for "${bucketName}". Ensure CLOUDFLARE_API_TOKEN grants account-level Workers R2 Storage access. Details: ${describeApiError(error)}`
    );
  }

  out(write, `PASS  R2 bucket "${bucketName}" is reachable.`);
}

export async function runCloudflareDeployPreflight(
  options: CloudflareDeployPreflightOptions
): Promise<void> {
  const write = options.write ?? ((chunk: string) => process.stdout.write(chunk));
  const target = resolveDeployTarget(options.deployEnv);
  const apiGet = options.apiGet ?? createCloudflareApiGet(options.accountId, options.apiToken);

  out(write, `ZeroLink Cloudflare deploy preflight (${target.label})`);
  out(write, '==================================================');

  await verifyWorkersScriptsAccess(options.accountId, apiGet, write);
  const zoneId = await resolveZoneId(target.zoneName, apiGet, write);
  await verifyWorkersRoutesAccess(zoneId, target.zoneName, apiGet, write);
  await verifyBucketAccess(options.accountId, target.bucketName, apiGet, write);

  out(write, '');
  out(write, 'All checks passed. Cloudflare deploy prerequisites are ready.');
}

function readRequiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

async function run(): Promise<void> {
  await runCloudflareDeployPreflight({
    accountId: readRequiredEnv('CLOUDFLARE_ACCOUNT_ID'),
    apiToken: readRequiredEnv('CLOUDFLARE_API_TOKEN'),
    deployEnv: resolveDeployEnvironment(),
  });
}

if (process.argv[1] === SCRIPT_FILE) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`check-cloudflare-deploy-prereqs failed: ${message}\n`);
    process.exitCode = 1;
  });
}
