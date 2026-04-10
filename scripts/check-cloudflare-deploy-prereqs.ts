import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export type DeployEnvironment = 'production' | 'staging';

interface DeployTarget {
  bucketName: string;
  label: DeployEnvironment;
  zoneName: string | null;
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

type TokenInspectionResult =
  | {
      details: CloudflareTokenDetailsResult;
      mode: 'strict';
    }
  | {
      failures: string[];
      mode: 'fallback';
    };

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

type CloudflareApiMethod = 'GET' | 'POST';
export type CloudflareApiGet = <T>(path: string) => Promise<CloudflareApiEnvelope<T>>;
export type CloudflareApiRequest = <T>(
  method: CloudflareApiMethod,
  path: string,
  body?: unknown
) => Promise<CloudflareApiEnvelope<T>>;

export interface CloudflareDeployPreflightOptions {
  accountId: string;
  apiGet?: CloudflareApiGet;
  apiRequest?: CloudflareApiRequest;
  apiToken: string;
  deployTarget?: DeployTarget;
  deployEnv: DeployEnvironment;
  write?: (chunk: string) => void;
}

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const DEFAULT_WRANGLER_CONFIG_URL = new URL('../packages/backend/wrangler.toml', import.meta.url);
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
const R2_WRITE_PROBE_BODY = { name: 'A' } as const;

function out(write: (chunk: string) => void, line: string): void {
  write(`${line}\n`);
}

function getApiErrorCode(error: unknown): number | null {
  if (!(error instanceof CloudflareApiError)) {
    return null;
  }
  return error.errors.find((item) => typeof item.code === 'number')?.code ?? null;
}

function getApiErrorCodes(error: unknown): number[] {
  if (!(error instanceof CloudflareApiError)) {
    return [];
  }

  return error.errors
    .map((item) => item.code)
    .filter((code): code is number => typeof code === 'number');
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

function createCloudflareApiRequest(accountId: string, apiToken: string): CloudflareApiRequest {
  return async function apiRequest<T>(
    method: CloudflareApiMethod,
    path: string,
    body?: unknown
  ): Promise<CloudflareApiEnvelope<T>> {
    const responseBody = await requestJson(method, path, apiToken, body);

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseBody) as unknown;
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

function createCloudflareApiGet(apiRequest: CloudflareApiRequest): CloudflareApiGet {
  return async function apiGet<T>(path: string): Promise<CloudflareApiEnvelope<T>> {
    return apiRequest<T>('GET', path);
  };
}

function isCloudflareEnvelope<T>(value: unknown): value is CloudflareApiEnvelope<T> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CloudflareApiEnvelope<T>>;
  return typeof candidate.success === 'boolean' && 'result' in candidate;
}

function requestJson(
  method: CloudflareApiMethod,
  path: string,
  apiToken: string,
  body?: unknown
): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestBody = body == null ? undefined : JSON.stringify(body);
    const req = httpsRequest(
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          ...(requestBody ? { 'Content-Type': 'application/json' } : {}),
        },
        hostname: 'api.cloudflare.com',
        method,
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

    if (requestBody) {
      req.write(requestBody);
    }
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

function stripTomlComments(line: string): string {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"' && !escaped) {
      inString = !inString;
    }

    if (char === '#' && !inString) {
      return line.slice(0, index);
    }

    escaped = char === '\\' && !escaped;
    if (char !== '\\') {
      escaped = false;
    }
  }

  return line;
}

function extractTomlString(source: string, key: string): string | null {
  const matcher = new RegExp(`${key}\\s*=\\s*"([^"]+)"`);
  return source.match(matcher)?.[1] ?? null;
}

function parseWranglerTargets(wranglerToml: string): Record<DeployEnvironment, DeployTarget> {
  const targets: Record<DeployEnvironment, DeployTarget> = {
    production: {
      bucketName: '',
      label: 'production',
      zoneName: null,
    },
    staging: {
      bucketName: '',
      label: 'staging',
      zoneName: null,
    },
  };

  let currentSection = 'root';
  let activeRouteTarget: DeployEnvironment | null = null;
  let routeBuffer = '';
  let activeBucketTarget: DeployEnvironment | null = null;
  let activeBucketBinding: string | null = null;
  let activeBucketName: string | null = null;

  const flushRoutes = (): void => {
    if (!activeRouteTarget) {
      return;
    }

    const zoneName = extractTomlString(routeBuffer, 'zone_name');
    if (zoneName) {
      targets[activeRouteTarget].zoneName = zoneName;
    }

    activeRouteTarget = null;
    routeBuffer = '';
  };

  const flushBucket = (): void => {
    if (!activeBucketTarget) {
      return;
    }

    if (
      activeBucketBinding === 'FILE_BUCKET' &&
      activeBucketName &&
      !targets[activeBucketTarget].bucketName
    ) {
      targets[activeBucketTarget].bucketName = activeBucketName;
    }

    activeBucketTarget = null;
    activeBucketBinding = null;
    activeBucketName = null;
  };

  for (const rawLine of wranglerToml.split(/\r?\n/u)) {
    const line = stripTomlComments(rawLine).trim();
    if (!line) {
      continue;
    }

    if (activeRouteTarget) {
      routeBuffer += `\n${line}`;
      if (line.includes(']')) {
        flushRoutes();
      }
      continue;
    }

    if (line.startsWith('[[') && line.endsWith(']]')) {
      flushBucket();
      currentSection = line.slice(2, -2).trim();
      activeBucketTarget =
        currentSection === 'r2_buckets'
          ? 'production'
          : currentSection === 'env.staging.r2_buckets'
            ? 'staging'
            : null;
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      flushBucket();
      currentSection = line.slice(1, -1).trim();
      continue;
    }

    if (line.startsWith('routes')) {
      const target =
        currentSection === 'root'
          ? 'production'
          : currentSection === 'env.staging'
            ? 'staging'
            : null;
      if (!target) {
        continue;
      }

      activeRouteTarget = target;
      routeBuffer = line;
      if (line.includes(']')) {
        flushRoutes();
      }
      continue;
    }

    if (activeBucketTarget) {
      if (line.startsWith('binding')) {
        activeBucketBinding = extractTomlString(line, 'binding');
        continue;
      }

      if (line.startsWith('bucket_name')) {
        activeBucketName = extractTomlString(line, 'bucket_name');
      }
    }
  }

  flushRoutes();
  flushBucket();
  return targets;
}

export function resolveDeployTarget(
  deployEnv: DeployEnvironment,
  options?: {
    wranglerToml?: string;
  }
): DeployTarget {
  const wranglerToml = options?.wranglerToml ?? readFileSync(DEFAULT_WRANGLER_CONFIG_URL, 'utf8');
  const target = parseWranglerTargets(wranglerToml)[deployEnv];

  if (!target.bucketName) {
    throw new Error(
      `Unable to resolve the R2 bucket for ${deployEnv} from packages/backend/wrangler.toml.`
    );
  }

  return target;
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

function isTokenInspectionFallbackEligible(error: unknown): boolean {
  if (!(error instanceof CloudflareApiError)) {
    return false;
  }

  if (error.statusCode === 401 || error.statusCode === 403) {
    return true;
  }

  const errorCodes = error.errors
    .map((item) => item.code)
    .filter((code): code is number => typeof code === 'number');
  if (errorCodes.length === 0) {
    return false;
  }

  return errorCodes.every((code) => code === 1000 || code === 9106 || code === 9109);
}

function isAuthorizationError(error: unknown): boolean {
  if (!(error instanceof CloudflareApiError)) {
    return false;
  }

  if (error.statusCode === 401 || error.statusCode === 403) {
    return true;
  }

  const errorCodes = getApiErrorCodes(error);
  if (errorCodes.length === 0) {
    return false;
  }

  return errorCodes.every(
    (code) => code === 1000 || code === 9106 || code === 9109 || code === 10000
  );
}

function isExpectedR2WriteProbeValidationError(error: unknown): boolean {
  if (!(error instanceof CloudflareApiError)) {
    return false;
  }

  return error.statusCode === 400 && !isAuthorizationError(error);
}

async function inspectCurrentToken(
  accountId: string,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<TokenInspectionResult> {
  out(write, '[1/6] Verifying current Cloudflare API token...');

  const failures: string[] = [];
  let canFallbackToReadChecks = true;

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
      return { details, mode: 'strict' };
    } catch (error) {
      failures.push(`${strategy.label}: ${describeApiError(error)}`);
      canFallbackToReadChecks &&= isTokenInspectionFallbackEligible(error);
    }
  }

  if (canFallbackToReadChecks) {
    out(
      write,
      `WARN  Token introspection is unavailable (${failures.join(' | ')}). Falling back to best-effort resource access checks; deploy-time write scopes cannot be proven ahead of wrangler deploy.`
    );
    return {
      failures,
      mode: 'fallback',
    };
  }

  throw new Error(`Unable to inspect the current Cloudflare API token. ${failures.join(' | ')}`);
}

async function resolveZoneId(
  zoneName: string | null,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<string | null> {
  if (!zoneName) {
    out(
      write,
      '[2/6] Skipping Cloudflare zone resolution because no routes are configured for this environment.'
    );
    return null;
  }

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

async function verifyWorkersScriptsApiReachable(
  accountId: string,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<void> {
  out(write, '[3/6] Checking Workers Scripts API reachability (best effort)...');

  try {
    await apiGet(`/accounts/${accountId}/workers/scripts`);
  } catch (error) {
    throw new Error(
      `Workers script API check failed for account ${accountId}. Ensure the deploy token can access Workers scripts. Details: ${describeApiError(error)}`
    );
  }

  out(write, 'PASS  Workers Scripts API is reachable.');
}

function verifyWorkersRoutesWritePermission(
  zoneId: string | null,
  zoneName: string | null,
  policies: CloudflareTokenPolicy[],
  write: (chunk: string) => void
): void {
  if (!zoneId || !zoneName) {
    out(
      write,
      '[4/6] Skipping Workers Routes write permission check because no routes are configured for this environment.'
    );
    return;
  }

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

async function verifyWorkersRoutesApiReachable(
  zoneId: string | null,
  zoneName: string | null,
  apiGet: CloudflareApiGet,
  write: (chunk: string) => void
): Promise<void> {
  if (!zoneId || !zoneName) {
    out(
      write,
      '[4/6] Skipping Workers Routes API reachability check because no routes are configured for this environment.'
    );
    return;
  }

  out(write, '[4/6] Checking Workers Routes API reachability (best effort)...');

  try {
    await apiGet(`/zones/${zoneId}/workers/routes`);
  } catch (error) {
    throw new Error(
      `Workers routes API check failed for zone "${zoneName}". Ensure the deploy token can access zone routes. Details: ${describeApiError(error)}`
    );
  }

  out(write, `PASS  Workers Routes API is reachable for "${zoneName}".`);
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

async function verifyR2StorageApiReachable(
  accountId: string,
  apiRequest: CloudflareApiRequest,
  write: (chunk: string) => void
): Promise<void> {
  out(write, '[5/6] Probing Workers R2 Storage write permission (best effort)...');

  try {
    await apiRequest('POST', `/accounts/${accountId}/r2/buckets`, R2_WRITE_PROBE_BODY);
    throw new Error('Cloudflare unexpectedly accepted an invalid R2 bucket create probe.');
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      if (isAuthorizationError(error)) {
        throw new Error(
          `Workers R2 Storage write probe failed for account ${accountId}. Ensure the deploy token grants write access to R2. Details: ${describeApiError(error)}`
        );
      }

      if (isExpectedR2WriteProbeValidationError(error)) {
        out(
          write,
          'PASS  Workers R2 Storage write endpoint rejected the invalid probe as expected.'
        );
        return;
      }
    }

    throw new Error(
      `Workers R2 Storage write probe failed for account ${accountId}. Details: ${describeApiError(error)}`
    );
  }
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
  const target = options.deployTarget ?? resolveDeployTarget(options.deployEnv);
  const apiRequest =
    options.apiRequest ?? createCloudflareApiRequest(options.accountId, options.apiToken);
  const apiGet = options.apiGet ?? createCloudflareApiGet(apiRequest);

  out(write, `ZeroLink Cloudflare deploy preflight (${target.label})`);
  out(write, '==================================================');

  const tokenInspection = await inspectCurrentToken(options.accountId, apiGet, write);
  const zoneId = await resolveZoneId(target.zoneName, apiGet, write);

  if (tokenInspection.mode === 'strict') {
    const policies = tokenInspection.details.policies ?? [];
    verifyWorkersScriptsWritePermission(options.accountId, policies, write);
    verifyWorkersRoutesWritePermission(zoneId, target.zoneName, policies, write);
    verifyR2StorageWritePermission(options.accountId, policies, write);
  } else {
    await verifyWorkersScriptsApiReachable(options.accountId, apiGet, write);
    await verifyWorkersRoutesApiReachable(zoneId, target.zoneName, apiGet, write);
    await verifyR2StorageApiReachable(options.accountId, apiRequest, write);
  }

  await verifyBucketExists(options.accountId, target.bucketName, apiGet, write);

  out(write, '');
  if (tokenInspection.mode === 'strict') {
    out(write, 'All checks passed. Cloudflare deploy prerequisites are ready.');
    return;
  }

  out(
    write,
    'Best-effort checks passed. Cloudflare resources are reachable, but deploy-time write scopes could not be pre-verified for this token.'
  );
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
