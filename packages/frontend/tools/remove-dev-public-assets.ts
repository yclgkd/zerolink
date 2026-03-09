import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DEV_ONLY_PUBLIC_ASSET_RELATIVE_PATHS = ['mockServiceWorker.js'] as const;

export async function removeDevOnlyPublicAssets(distDir: string): Promise<void> {
  await Promise.all(
    DEV_ONLY_PUBLIC_ASSET_RELATIVE_PATHS.map(async (relativePath) => {
      const assetPath = path.resolve(distDir, relativePath);
      await fs.rm(assetPath, { force: true });
    })
  );
}
