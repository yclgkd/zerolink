import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkEntryAssetBinding, parseSignedManifest } from '../verify-manifest-metadata';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zl-verify-entry-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('parseSignedManifest', () => {
  it('returns null when entryAssetPath is missing', () => {
    const rawManifest = JSON.stringify({
      buildTime: '2026-03-10T00:00:00.000Z',
      commitHash: 'abc1234',
      files: {
        'assets/index.js': 'a'.repeat(64),
      },
      version: '1.2.3',
    });

    expect(parseSignedManifest(rawManifest)).toBeNull();
  });

  it('returns null when entryAssetPath is unsafe', () => {
    const rawManifest = JSON.stringify({
      buildTime: '2026-03-10T00:00:00.000Z',
      commitHash: 'abc1234',
      entryAssetPath: 'https://cdn.example.com/app.js',
      files: {
        'assets/index.js': 'a'.repeat(64),
      },
      version: '1.2.3',
    });

    expect(parseSignedManifest(rawManifest)).toBeNull();
  });
});

describe('checkEntryAssetBinding', () => {
  it('fails when index.html boots a different entry asset than the signed manifest', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'index.html'),
      '<script type="module" crossorigin src="/assets/index-runtime.js"></script>'
    );

    const result = await checkEntryAssetBinding(
      {
        buildTime: '2026-03-10T00:00:00.000Z',
        commitHash: 'abc1234',
        entryAssetPath: 'assets/index-signed.js',
        files: {
          'assets/index-runtime.js': 'a'.repeat(64),
          'assets/index-signed.js': 'b'.repeat(64),
        },
        version: '1.2.3',
      },
      tmpDir
    );

    expect(result).toEqual({
      actual: 'assets/index-runtime.js',
      expected: 'assets/index-signed.js',
      ok: false,
    });
  });
});
