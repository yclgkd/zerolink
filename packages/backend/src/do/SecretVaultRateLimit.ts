import { RateLimitError, type VaultContext } from './SecretVaultTypes.ts';

export type RateLimitedEndpoint =
  | 'lock_begin'
  | 'lock_commit'
  | 'compound_begin'
  | 'compound_commit';

export type RateLimitScope = 'public' | 'authorized';

export const RATE_LIMITS: Record<RateLimitedEndpoint, { maxRequests: number; windowMs: number }> = {
  lock_begin: { maxRequests: 3, windowMs: 60_000 },
  lock_commit: { maxRequests: 5, windowMs: 60_000 },
  compound_begin: { maxRequests: 3, windowMs: 60_000 },
  compound_commit: { maxRequests: 10, windowMs: 60_000 },
};

export function buildRateLimitSubject(params: {
  scope: RateLimitScope;
  callerKey?: string | undefined;
  sessionKey?: string | undefined;
}): string {
  const callerSubject = params.callerKey?.trim() || 'anonymous';
  if (params.scope === 'public') {
    return `public:${callerSubject}`;
  }

  const sessionSubject = params.sessionKey?.trim() || callerSubject;
  return `authorized:${sessionSubject}`;
}

export function enforceRateLimit(
  vc: VaultContext,
  endpoint: RateLimitedEndpoint,
  now: number,
  subjectKey = 'shared'
): void {
  const { maxRequests, windowMs } = RATE_LIMITS[endpoint];
  const bucketKey = `${endpoint}:${subjectKey}`;
  const existing = vc.rateLimitWindows.get(bucketKey);

  if (!existing || now - existing.windowStart >= windowMs) {
    vc.rateLimitWindows.set(bucketKey, { count: 1, windowStart: now });
    return;
  }

  if (existing.count >= maxRequests) {
    const retryAfterSeconds = (existing.windowStart + windowMs - now) / 1000;
    throw new RateLimitError(retryAfterSeconds, `${endpoint} rate limit exceeded`);
  }

  existing.count += 1;
}
