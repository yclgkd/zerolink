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

interface CloudflareZoneSummary {
  id?: string;
  name?: string;
}

interface CloudflareResourceMap {
  [key: string]: CloudflareResourceValue;
}

type CloudflareResourceValue = string | CloudflareResourceMap;

interface CloudflareTokenPermissionGroup {
  name?: string;
}

interface CloudflareTokenPolicy {
  effect?: 'allow' | 'deny';
  permission_groups?: CloudflareTokenPermissionGroup[];
  resources?: CloudflareResourceMap;
}

interface CloudflareTokenDetailsResult {
  id?: string;
  name?: string;
  policies?: CloudflareTokenPolicy[];
  status?: 'active' | 'disabled' | 'expired' | string;
}

interface CloudflareTokenVerifyResult {
  id?: string;
  status?: 'active' | 'disabled' | 'expired' | string;
}

interface TokenInspectionStrategy {
  detailsPath: (accountId: string, tokenId: string) => string;
  label: string;
  verifyPath: (accountId: string) => string;
}

interface PermissionRequirement {
  permissionGroupName: string;
  resourceDescription: string;
  resourceMatcher: (resourceKeys: Set<string>) => boolean;
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
const TOKEN_INSPECTION_STRATEGIES: TokenInspectionStrategy[] = [
  {
    detailsPath: (_accountId, tokenId) => `/user/tokens/${tokenId}`,
    label: 'user-owned token',
    verifyPath: () => '/user/tokens/verify',
  },
  {
    detailsPath: (accountId, tokenId) => `/accounts/${accountId}/tokens/${tokenId}`,
    label: 'account-owned token',
    verifyPath: (accountId) => `/accounts/${accountId}/tokens/verify`,
  },
];

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

function collectGrantedResourceKeys(
  resources: CloudflareResourceMap | undefined,
  keys = new Set<string>()
): Set<string> {
  if (!resources) {
    return keys;
  }

  for (const [resourceKey, value] of Object.entries(resources)) {
    if (typeof value === 'string') {
      if (value === '*') {
        keys.add(resourceKey);
      }
      continue;
    }

    if (value && typeof value === 'object') {
      collectGrantedResourceKeys(value, keys);
    }
  }

  return keys;
}

function policyMatchesRequirement(
  policy: CloudflareTokenPolicy,
  requirement: PermissionRequirement
): boolean {
  const permissionGroupNames = policy.permission_groups?.map((group) => group.name).filter(Boolean);
  if (!permissionGroupNames?.includes(requirement.permissionGroupName)) {
    return false;
  }

  const resourceKeys = collectGrantedResourceKeys(policy.resources);
  return requirement.resourceMatcher(resourceKeys);
}

function assertPermissionGranted(
  policies: CloudflareTokenPolicy[],
  requirement: PermissionRequirement
): void {
  const isDenied = policies.some(
    (policy) => policy.effect === 'deny' && policyMatchesRequirement(policy, requirement)
  );
  if (isDenied) {
    throw new Error(
      `Token is explicitly denied ${requirement.permissionGroupName} for ${requirement.resourceDescription}.`
    );
  }

  const isAllowed = policies.some(
    (policy) => policy.effect === 'allow' && policyMatchesRequirement(policy, requirement)
  );
  if (!isAllowed) {
    throw new Error(
      `Token is missing ${requirement.permissionGroupName} for ${requirement.resourceDescription}.`
    );
  }
}

function createExactOrWildcardMatcher(exactKey: string, wildcardKey: string) {
  return (resourceKeys: Set<string>): boolean =>
    resourceKeys.has(exactKey) || resourceKeys.has(wildcardKey);
}

async function verifyCurrentToken(
  accountId: string,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<CloudflareTokenDetailsResult> {
  out(write, '[1/6] Verifying current Cloudflare API token...');

  const failures: string[] = [];

  for (const strategy of TOKEN_INSPECTION_STRATEGIES) {
    try {
      const verifyEnvelope = await apiGet<CloudflareTokenVerifyResult>(
        strategy.verifyPath(accountId)
      );
      const tokenId = verifyEnvelope.result.id?.trim();
      const tokenStatus = verifyEnvelope.result.status;

      if (!tokenId) {
        throw new Error('Token verification did not return a token id.');
      }
      if (tokenStatus !== 'active') {
        throw new Error(`Token status is "${tokenStatus ?? 'unknown'}".`);
      }

      const detailsEnvelope = await apiGet<CloudflareTokenDetailsResult>(
        strategy.detailsPath(accountId, tokenId)
      );
      const details = detailsEnvelope.result;

      if (details.status !== 'active') {
        throw new Error(
          `Token details returned non-active status "${details.status ?? 'unknown'}".`
        );
      }

      out(
        write,
        `PASS  Verified active ${strategy.label}${details.name ? ` "${details.name}"` : ''}.`
      );
      return details;
    } catch (error) {
      failures.push(`${strategy.label}: ${describeApiError(error)}`);
    }
  }

  throw new Error(`Unable to inspect the current Cloudflare API token. ${failures.join(' | ')}`);
}

async function resolveZoneId(
  zoneName: string,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<string> {
  out(write, '[2/6] Resolving Cloudflare zone...');

  let envelope: CloudflareApiEnvelope<CloudflareZoneSummary[]>;
  try {
    const params = new URLSearchParams({ name: zoneName });
    envelope = await apiGet<CloudflareZoneSummary[]>(`/zones?${params.toString()}`);
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

function verifyWorkersScriptsWritePermission(
  accountId: string,
  policies: CloudflareTokenPolicy[],
  write: (chunk: string) => void
): void {
  out(write, '[3/6] Validating Workers Scripts write permission...');

  assertPermissionGranted(policies, {
    permissionGroupName: 'Workers Scripts Write',
    resourceDescription: `account ${accountId}`,
    resourceMatcher: createExactOrWildcardMatcher(
      `com.cloudflare.api.account.${accountId}`,
      'com.cloudflare.api.account.*'
    ),
  });

  out(write, 'PASS  Token grants Workers Scripts Write.');
}

function verifyWorkersRoutesWritePermission(
  zoneId: string,
  zoneName: string,
  policies: CloudflareTokenPolicy[],
  write: (chunk: string) => void
): void {
  out(write, '[4/6] Validating Workers Routes write permission...');

  assertPermissionGranted(policies, {
    permissionGroupName: 'Workers Routes Write',
    resourceDescription: `zone ${zoneName}`,
    resourceMatcher: createExactOrWildcardMatcher(
      `com.cloudflare.api.account.zone.${zoneId}`,
      'com.cloudflare.api.account.zone.*'
    ),
  });

  out(write, `PASS  Token grants Workers Routes Write for "${zoneName}".`);
}

function verifyR2StorageWritePermission(
  accountId: string,
  policies: CloudflareTokenPolicy[],
  write: (chunk: string) => void
): void {
  out(write, '[5/6] Validating Workers R2 Storage write permission...');

  assertPermissionGranted(policies, {
    permissionGroupName: 'Workers R2 Storage Write',
    resourceDescription: `account ${accountId}`,
    resourceMatcher: createExactOrWildcardMatcher(
      `com.cloudflare.api.account.${accountId}`,
      'com.cloudflare.api.account.*'
    ),
  });

  out(write, 'PASS  Token grants Workers R2 Storage Write.');
}

async function verifyBucketExists(
  accountId: string,
  bucketName: string,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<void> {
  out(write, '[6/6] Checking required R2 bucket...');

  try {
    await apiGet(`/accounts/${accountId}/r2/buckets/${bucketName}`);
  } catch (error) {
    if (getApiErrorCode(error) === 10006) {
      throw new Error(
        `Required R2 bucket "${bucketName}" does not exist. Create it first with: npx wrangler r2 bucket create ${bucketName}`
      );
    }

    throw new Error(
      `R2 bucket lookup failed for "${bucketName}". Ensure the token can read the bound bucket metadata. Details: ${describeApiError(error)}`
    );
  }

  out(write, `PASS  R2 bucket "${bucketName}" exists.`);
}

export async function runCloudflareDeployPreflight(
  options: CloudflareDeployPreflightOptions
): Promise<void> {
  const write = options.write ?? ((chunk: string) => process.stdout.write(chunk));
  const target = resolveDeployTarget(options.deployEnv);
  const apiGet = options.apiGet ?? createCloudflareApiGet(options.accountId, options.apiToken);

  out(write, `ZeroLink Cloudflare deploy preflight (${target.label})`);
  out(write, '==================================================');

  const tokenDetails = await verifyCurrentToken(options.accountId, apiGet, write);
  const policies = tokenDetails.policies ?? [];
  const zoneId = await resolveZoneId(target.zoneName, apiGet, write);

  verifyWorkersScriptsWritePermission(options.accountId, policies, write);
  verifyWorkersRoutesWritePermission(zoneId, target.zoneName, policies, write);
  verifyR2StorageWritePermission(options.accountId, policies, write);
  await verifyBucketExists(options.accountId, target.bucketName, apiGet, write);

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
