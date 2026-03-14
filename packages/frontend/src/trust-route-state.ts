export interface TrustRouteState {
  returnTo: string;
}

export function createTrustRouteState({
  pathname,
  search,
}: {
  pathname: string;
  search: string;
  hash: string;
}): TrustRouteState {
  return {
    returnTo: `${pathname}${search}`,
  };
}

export function hasTrustRouteReturnTo(state: unknown): state is TrustRouteState {
  if (!state || typeof state !== 'object') {
    return false;
  }

  const returnTo = (state as { returnTo?: unknown }).returnTo;
  return typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//');
}
