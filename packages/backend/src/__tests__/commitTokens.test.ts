import { describe, expect, it } from 'vitest';

import { computeCallerKey, normalizeUserAgentFamily } from '../commitTokens.ts';

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
});
