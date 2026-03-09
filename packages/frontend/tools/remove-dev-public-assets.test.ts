import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeDevOnlyPublicAssets } from './remove-dev-public-assets';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zl-dev-assets-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe('removeDevOnlyPublicAssets', () => {
  it('removes mockServiceWorker.js from the output directory', async () => {
    const workerPath = path.join(tmpDir, 'mockServiceWorker.js');
    await fs.writeFile(workerPath, '/* mock worker */', 'utf8');

    await removeDevOnlyPublicAssets(tmpDir);

    await expect(fs.stat(workerPath)).rejects.toThrow();
  });

  it('preserves non-whitelisted runtime and Pages control files', async () => {
    await fs.mkdir(path.join(tmpDir, 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '_headers'),
      '/index.html\n  Cache-Control: no-store',
      'utf8'
    );
    await fs.writeFile(path.join(tmpDir, '_redirects'), '/ /index.html 200', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'index.html'), '<html></html>', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'assets', 'index.js'), 'console.log("ok");', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'mockServiceWorker.js'), '/* mock worker */', 'utf8');

    await removeDevOnlyPublicAssets(tmpDir);

    await expect(fs.readFile(path.join(tmpDir, '_headers'), 'utf8')).resolves.toContain('no-store');
    await expect(fs.readFile(path.join(tmpDir, '_redirects'), 'utf8')).resolves.toContain(
      '/index.html'
    );
    await expect(fs.readFile(path.join(tmpDir, 'index.html'), 'utf8')).resolves.toContain('<html>');
    await expect(fs.readFile(path.join(tmpDir, 'assets', 'index.js'), 'utf8')).resolves.toContain(
      'console.log'
    );
  });

  it('is idempotent when the dev-only files are already absent', async () => {
    await fs.writeFile(path.join(tmpDir, 'index.html'), '<html></html>', 'utf8');

    await expect(removeDevOnlyPublicAssets(tmpDir)).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(tmpDir, 'index.html'), 'utf8')).resolves.toContain('<html>');
  });
});
