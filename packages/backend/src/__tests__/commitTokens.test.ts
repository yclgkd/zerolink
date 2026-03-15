import type { Base64Url, UnixMs } from '@zerolink/shared';
import { describe, expect, it } from 'vitest';

import {
  computeCallerKey,
  createCommitToken,
  hashCommitToken,
  normalizeUserAgentFamily,
  verifyCommitToken,
} from '../commitTokens.ts';

function tamperTokenSignature(token: string): string {
  const separator = token.lastIndexOf('.');
  const signature = token.slice(separator + 1);
  const replacement = signature.endsWith('A') ? 'B' : 'A';
  return `${token.slice(0, separator + 1)}${signature.slice(0, -1)}${replacement}`;
}

function asBase64Url(value: string): Base64Url {
  return value as Base64Url;
}

function asUnixMs(value: number): UnixMs {
  return value as UnixMs;
}

describe('commit token helpers', () => {
  it.each([
    ['curl/8.7.1', 'curl'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36',
      'chromium',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
      'firefox',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
      'safari',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A.240105.004; wv) AppleWebKit/537.36 Version/4.0 Chrome/123.0.0.0 Mobile Safari/537.36',
      'android-webview',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
      'edge',
    ],
  ])('normalizes %s to %s', (userAgent, family) => {
    expect(normalizeUserAgentFamily(userAgent)).toBe(family);
  });

  it('derives caller keys from normalized server-visible signals', async () => {
    const secret = 'commit-token-secret';
    const ip = '198.51.100.44';
    const chromiumA = await computeCallerKey(
      secret,
      ip,
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36'
    );
    const chromiumB = await computeCallerKey(
      secret,
      ip,
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36'
    );
    const curl = await computeCallerKey(secret, ip, 'curl/8.7.1');

    expect(chromiumA).toBe(chromiumB);
    expect(chromiumA).not.toBe(curl);
    expect(chromiumA).not.toContain(ip);
  });

  it('round-trips commit tokens through create and verify', async () => {
    const payload = {
      kind: 'lock' as const,
      uuid: 'channel-uuid',
      challengeId: asBase64Url('challenge-id'),
      callerKey: asBase64Url('caller-key'),
      iat: asUnixMs(1_730_000_000_000),
      exp: asUnixMs(1_730_000_060_000),
    };
    const token = await createCommitToken('commit-token-secret', payload);

    await expect(verifyCommitToken('commit-token-secret', token)).resolves.toEqual({
      v: '1',
      ...payload,
    });
  });

  it('rejects commit tokens whose signature was tampered with', async () => {
    const token = await createCommitToken('commit-token-secret', {
      kind: 'compound',
      uuid: 'channel-uuid',
      challengeId: asBase64Url('challenge-id'),
      callerKey: asBase64Url('caller-key'),
      iat: asUnixMs(1_730_000_000_000),
      exp: asUnixMs(1_730_000_060_000),
    });

    await expect(
      verifyCommitToken('commit-token-secret', tamperTokenSignature(token))
    ).resolves.toBeNull();
  });

  it.each([
    '',
    'no-dot-token',
    'a.b.c',
    '%%%invalid%%%.signature',
  ])('rejects malformed commit token %s', async (token) => {
    await expect(verifyCommitToken('commit-token-secret', token)).resolves.toBeNull();
  });

  it('hashes commit tokens deterministically and distinguishes different inputs', async () => {
    const tokenA = await createCommitToken('commit-token-secret', {
      kind: 'lock',
      uuid: 'channel-uuid',
      challengeId: asBase64Url('challenge-id-a'),
      callerKey: asBase64Url('caller-key'),
      iat: asUnixMs(1_730_000_000_000),
      exp: asUnixMs(1_730_000_060_000),
    });
    const tokenB = await createCommitToken('commit-token-secret', {
      kind: 'lock',
      uuid: 'channel-uuid',
      challengeId: asBase64Url('challenge-id-b'),
      callerKey: asBase64Url('caller-key'),
      iat: asUnixMs(1_730_000_000_000),
      exp: asUnixMs(1_730_000_060_000),
    });

    await expect(hashCommitToken(tokenA)).resolves.toBe(await hashCommitToken(tokenA));
    await expect(hashCommitToken(tokenA)).resolves.not.toBe(await hashCommitToken(tokenB));
  });
});
