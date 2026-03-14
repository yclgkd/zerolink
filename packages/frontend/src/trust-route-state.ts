export interface TrustRouteState {
  returnTo: string;
}

interface TrustRouteLocation {
  pathname: string;
  search: string;
}

export function createTrustRouteState({ pathname, search }: TrustRouteLocation): TrustRouteState {
  return {
    // Never carry fragments through router state; share links use #k for receiver-only lock material.
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
