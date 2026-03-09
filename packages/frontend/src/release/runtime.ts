import type { VerifiedReleaseSnapshot } from './verification';

declare global {
  interface Window {
    __ZEROLINK_RELEASE_VERIFICATION__?: VerifiedReleaseSnapshot;
  }
}

export function getVerifiedReleaseSnapshot(): VerifiedReleaseSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__ZEROLINK_RELEASE_VERIFICATION__ ?? null;
}

export function setVerifiedReleaseSnapshot(snapshot: VerifiedReleaseSnapshot | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (snapshot) {
    window.__ZEROLINK_RELEASE_VERIFICATION__ = snapshot;
    return;
  }
  delete window.__ZEROLINK_RELEASE_VERIFICATION__;
}
