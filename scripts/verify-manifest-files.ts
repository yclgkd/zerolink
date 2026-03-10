import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type ManifestFiles = Record<string, string>;

function hashBufferHex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function verifyFileHashes(
  manifest: { files: ManifestFiles },
  distDir: string
): Promise<{ path: string; expected: string; actual: string; ok: boolean }[]> {
  const distDirBoundary = distDir.endsWith(path.sep) ? distDir : `${distDir}${path.sep}`;

  return Promise.all(
    Object.entries(manifest.files).map(async ([relativePath, expected]) => {
      const segments = relativePath.split('/');
      if (path.isAbsolute(relativePath) || segments.includes('..') || segments.includes('')) {
        return {
          path: relativePath,
          expected,
          actual: 'PATH_TRAVERSAL',
          ok: false,
        };
      }

      const absolutePath = path.resolve(distDir, ...segments);
      if (!absolutePath.startsWith(distDirBoundary)) {
        return {
          path: relativePath,
          expected,
          actual: 'PATH_TRAVERSAL',
          ok: false,
        };
      }

      let actual: string;
      try {
        const content = await fs.readFile(absolutePath);
        actual = hashBufferHex(content);
      } catch {
        actual = 'FILE_NOT_FOUND';
      }

      return { path: relativePath, expected, actual, ok: actual === expected };
    })
  );
}
