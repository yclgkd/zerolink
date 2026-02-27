import { describe, expect, it, vi } from 'vitest';

vi.mock('@zerolink/shared', async () => {
  const actual = await vi.importActual<typeof import('@zerolink/shared')>('@zerolink/shared');
  return {
    ...actual,
    ROUTE_PATTERN: {
      ...actual.ROUTE_PATTERN,
      SHARE: 's/:uuid',
      MANAGE: 'm/:uuid',
    },
  };
});

import { APP_ROUTE_ID, APP_ROUTES } from '../routes';

describe('routes path normalization', () => {
  it('keeps child path unchanged when route pattern does not start with slash', () => {
    const shellRoute = APP_ROUTES.find((route) => route.id === APP_ROUTE_ID.SHELL);
    expect(shellRoute?.children).toBeTruthy();

    const shareRoute = shellRoute?.children?.find((route) => route.id === APP_ROUTE_ID.SHARE);
    const manageRoute = shellRoute?.children?.find((route) => route.id === APP_ROUTE_ID.MANAGE);

    expect(shareRoute?.path).toBe('s/:uuid');
    expect(manageRoute?.path).toBe('m/:uuid');
  });
});
