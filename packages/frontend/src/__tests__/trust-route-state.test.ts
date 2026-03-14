import { describe, expect, it } from 'vitest';

import { createTrustRouteState } from '../trust-route-state';

describe('createTrustRouteState', () => {
  it('preserves pathname and search but strips hash fragments', () => {
    const shareLocation = {
      pathname: '/s/aaaaaaaaaaaaaaaaaaaaa',
      search: '?foo=bar',
      hash: '#k=secret-fragment',
    };

    expect(createTrustRouteState(shareLocation)).toEqual({
      returnTo: '/s/aaaaaaaaaaaaaaaaaaaaa?foo=bar',
    });
  });
});
