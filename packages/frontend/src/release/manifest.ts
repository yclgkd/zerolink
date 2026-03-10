export interface ReleaseManifest {
  version: string;
  commitHash: string;
  buildTime: string;
  entryAssetPath: string;
  files: Record<string, string>;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return new URL('/', baseUrl).href;
}

export function isSafeManifestPath(relativePath: string): boolean {
  if (!/^[A-Za-z0-9._/-]+$/u.test(relativePath)) {
    return false;
  }
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('./') ||
    relativePath.includes('//')
  ) {
    return false;
  }
  const segments = relativePath.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function parseManifest(rawManifest: string): ReleaseManifest | null {
  try {
    const parsed = JSON.parse(rawManifest) as Partial<ReleaseManifest>;
    if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
      return null;
    }
    if (typeof parsed.commitHash !== 'string' || parsed.commitHash.length === 0) {
      return null;
    }
    if (typeof parsed.buildTime !== 'string' || Number.isNaN(Date.parse(parsed.buildTime))) {
      return null;
    }
    if (typeof parsed.entryAssetPath !== 'string' || !isSafeManifestPath(parsed.entryAssetPath)) {
      return null;
    }
    if (!parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
      return null;
    }

    const files = Object.entries(parsed.files).every(
      ([relativePath, hash]) =>
        typeof relativePath === 'string' && /^[0-9a-f]{64}$/u.test(String(hash))
    );
    if (!files || !Object.hasOwn(parsed.files, parsed.entryAssetPath)) {
      return null;
    }

    return parsed as ReleaseManifest;
  } catch {
    return null;
  }
}

export function toReleasePath(pathOrUrl: string, baseUrl: string): string | null {
  try {
    const assetUrl = new URL(pathOrUrl, baseUrl);
    if (assetUrl.origin !== new URL(baseUrl).origin) {
      return null;
    }

    const relativePath = assetUrl.pathname.replace(/^\/+/u, '');
    return isSafeManifestPath(relativePath) ? relativePath : null;
  } catch {
    return null;
  }
}
