import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SignedManifest } from './generate-manifest';
import { extractEntryAssetPath } from './manifest-entry';

type ManifestMetadata = Pick<
  SignedManifest,
  'version' | 'commitHash' | 'buildTime' | 'entryAssetPath' | 'files'
>;

export function parseSignedManifest(rawManifest: string): ManifestMetadata | null {
  try {
    const parsed = JSON.parse(rawManifest) as Partial<SignedManifest>;
    if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
      return null;
    }
    if (typeof parsed.commitHash !== 'string' || parsed.commitHash.length === 0) {
      return null;
    }
    if (typeof parsed.buildTime !== 'string' || Number.isNaN(Date.parse(parsed.buildTime))) {
      return null;
    }
    if (typeof parsed.entryAssetPath !== 'string') {
      return null;
    }
    if (!parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
      return null;
    }

    extractEntryAssetPath(
      `<script type="module" src="/${parsed.entryAssetPath.replace(/^\/+/u, '')}"></script>`
    );
    const fileHashes = Object.entries(parsed.files).every(
      ([relativePath, hash]) =>
        typeof relativePath === 'string' && /^[0-9a-f]{64}$/u.test(String(hash))
    );
    if (!fileHashes || !Object.hasOwn(parsed.files, parsed.entryAssetPath)) {
      return null;
    }

    return parsed as ManifestMetadata;
  } catch {
    return null;
  }
}

export async function checkEntryAssetBinding(
  manifest: ManifestMetadata,
  distDir: string
): Promise<{ ok: boolean; expected: string; actual: string }> {
  const indexHtmlPath = path.resolve(distDir, 'index.html');

  try {
    const indexHtml = await fs.readFile(indexHtmlPath, 'utf8');
    const actual = extractEntryAssetPath(indexHtml);
    return {
      actual,
      expected: manifest.entryAssetPath,
      ok: actual === manifest.entryAssetPath,
    };
  } catch {
    return {
      actual: 'INDEX_HTML_ENTRY_INVALID',
      expected: manifest.entryAssetPath,
      ok: false,
    };
  }
}
