import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildManifest,
  collectFilePaths,
  extractEntryAssetPath,
  hashFileHex,
  toPosixRelativePath,
} from '../generate-manifest';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zl-manifest-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('toPosixRelativePath', () => {
  it('returns posix-style relative path', () => {
    const root = '/tmp/dist';
    const file = '/tmp/dist/assets/app.js';
    expect(toPosixRelativePath(file, root)).toBe('assets/app.js');
  });

  it('handles files directly under root', () => {
    const root = '/tmp/dist';
    const file = '/tmp/dist/index.html';
    expect(toPosixRelativePath(file, root)).toBe('index.html');
  });

  it('handles deeply nested paths', () => {
    const root = '/tmp/dist';
    const file = '/tmp/dist/a/b/c/file.css';
    expect(toPosixRelativePath(file, root)).toBe('a/b/c/file.css');
  });
});

describe('hashFileHex', () => {
  it('returns a 64-character hex string (SHA-256)', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'hello world');

    const hash = await hashFileHex(filePath);
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('matches known SHA-256 of content', async () => {
    const content = 'ZeroLink test content';
    const filePath = path.join(tmpDir, 'known.txt');
    await fs.writeFile(filePath, content);

    const expected = createHash('sha256').update(Buffer.from(content)).digest('hex');
    const actual = await hashFileHex(filePath);
    expect(actual).toBe(expected);
  });

  it('produces different hashes for different content', async () => {
    const fileA = path.join(tmpDir, 'a.txt');
    const fileB = path.join(tmpDir, 'b.txt');
    await fs.writeFile(fileA, 'content A');
    await fs.writeFile(fileB, 'content B');

    const hashA = await hashFileHex(fileA);
    const hashB = await hashFileHex(fileB);
    expect(hashA).not.toBe(hashB);
  });

  it('throws when file does not exist', async () => {
    await expect(hashFileHex('/nonexistent/path/file.txt')).rejects.toThrow();
  });
});

describe('collectFilePaths', () => {
  it('collects files recursively and sorts them', async () => {
    await fs.mkdir(path.join(tmpDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'index.html'), '<html></html>');
    await fs.writeFile(path.join(tmpDir, 'assets', 'app.js'), 'var x = 1;');
    await fs.writeFile(path.join(tmpDir, 'assets', 'app.css'), 'body {}');

    const paths = await collectFilePaths(tmpDir);
    const relative = paths.map((p) => toPosixRelativePath(p, tmpDir));

    expect(relative).toEqual(['assets/app.css', 'assets/app.js']);
  });

  it('ignores root-level files outside the signed assets directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'app.js'), 'var x = 1;');
    await fs.writeFile(path.join(tmpDir, 'robots.txt'), 'User-agent: *');
    await fs.writeFile(path.join(tmpDir, 'assets', 'style.css'), 'body {}');

    const paths = await collectFilePaths(tmpDir);
    expect(paths.map((filePath) => toPosixRelativePath(filePath, tmpDir))).toEqual([
      'assets/style.css',
    ]);
  });

  it('returns empty array for an empty directory', async () => {
    const paths = await collectFilePaths(tmpDir);
    expect(paths).toHaveLength(0);
  });

  it('returns empty when dist only contains root documents outside the whitelist', async () => {
    await fs.writeFile(path.join(tmpDir, '_redirects'), '/ /index.html 200');
    await fs.writeFile(path.join(tmpDir, '_headers'), '/index.html\n  Cache-Control: no-store');
    await fs.writeFile(path.join(tmpDir, 'index.html'), '<html></html>');
    await fs.writeFile(path.join(tmpDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');

    const paths = await collectFilePaths(tmpDir);
    expect(paths).toEqual([]);
  });

  it('returns empty when the signed assets directory does not exist', async () => {
    await expect(collectFilePaths(path.join(tmpDir, 'nonexistent'))).resolves.toEqual([]);
  });
});

describe('extractEntryAssetPath', () => {
  it('returns the normalized module entry asset path from index.html', () => {
    const html = '<script type="module" crossorigin src="/assets/index-abc123.js"></script>';

    expect(extractEntryAssetPath(html)).toBe('assets/index-abc123.js');
  });

  it('throws when the module entry asset path is missing', () => {
    const html = '<script src="/assets/index-abc123.js"></script>';

    expect(() => extractEntryAssetPath(html)).toThrow('module entry script');
  });

  it('throws when the module entry asset points to another origin', () => {
    const html = '<script type="module" src="https://cdn.example.com/app.js"></script>';

    expect(() => extractEntryAssetPath(html)).toThrow('same-origin');
  });
});

describe('buildManifest', () => {
  it('adds entryAssetPath while keeping root documents out of signed files', async () => {
    await fs.mkdir(path.join(tmpDir, 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'index.html'),
      '<script type="module" crossorigin src="/assets/index-abc123.js"></script>'
    );
    await fs.writeFile(path.join(tmpDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
    await fs.writeFile(path.join(tmpDir, 'assets', 'index-abc123.js'), 'console.log("entry");');

    const manifest = await buildManifest({
      buildTime: '2026-03-10T00:00:00.000Z',
      commitHash: 'abc1234',
      distDir: tmpDir,
      version: '1.2.3',
    });

    expect(manifest.entryAssetPath).toBe('assets/index-abc123.js');
    expect(manifest.files).toHaveProperty('assets/index-abc123.js');
    expect(manifest.files).not.toHaveProperty('index.html');
    expect(manifest.files).not.toHaveProperty('robots.txt');
  });

  it('throws when index.html points to an entry asset outside the signed manifest files', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'index.html'),
      '<script type="module" crossorigin src="/bootstrap.js"></script>'
    );
    await fs.writeFile(path.join(tmpDir, 'bootstrap.js'), 'console.log("root entry");');

    await expect(
      buildManifest({
        buildTime: '2026-03-10T00:00:00.000Z',
        commitHash: 'abc1234',
        distDir: tmpDir,
        version: '1.2.3',
      })
    ).rejects.toThrow('entry asset');
  });
});
