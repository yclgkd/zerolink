import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, mergeConfig } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import viteConfig from '../vite.config';

interface VerificationBuildArtifacts {
  readonly bootstrapEntryPath: string;
  readonly bootstrapSource: string;
  readonly jsAssets: readonly string[];
  readonly outDir: string;
}

const createdDirs: string[] = [];
let artifacts: VerificationBuildArtifacts | null = null;

function findBootstrapEntry(html: string): string {
  const match = html.match(
    /<script type="module" crossorigin src="\/assets\/([^"]+\.js)"><\/script>/u
  );
  if (!match?.[1]) {
    throw new Error('Could not locate the verification bootstrap entry in index.html');
  }
  return match[1];
}

function hasNobleMarker(source: string): boolean {
  return (
    source.includes('Point expected') ||
    source.includes('invalid wnaf') ||
    source.includes('crypto.subtle must be defined, consider polyfill')
  );
}

async function buildVerificationArtifacts(): Promise<VerificationBuildArtifacts> {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'zerolink-verification-build-'));
  createdDirs.push(outDir);

  const previousFlag = process.env['VITE_RELEASE_VERIFICATION_REQUIRED'];
  process.env['VITE_RELEASE_VERIFICATION_REQUIRED'] = 'true';
  try {
    await build(
      mergeConfig(viteConfig, {
        logLevel: 'silent',
        build: {
          emptyOutDir: true,
          outDir,
        },
      })
    );
  } finally {
    if (previousFlag === undefined) {
      delete process.env['VITE_RELEASE_VERIFICATION_REQUIRED'];
    } else {
      process.env['VITE_RELEASE_VERIFICATION_REQUIRED'] = previousFlag;
    }
  }

  const indexHtml = await readFile(path.join(outDir, 'index.html'), 'utf8');
  const bootstrapEntryName = findBootstrapEntry(indexHtml);
  const bootstrapEntryPath = path.join(outDir, 'assets', bootstrapEntryName);
  const bootstrapSource = await readFile(bootstrapEntryPath, 'utf8');
  const jsAssets = (await readdir(path.join(outDir, 'assets')))
    .filter((fileName) => fileName.endsWith('.js'))
    .map((fileName) => path.join(outDir, 'assets', fileName));

  return {
    bootstrapEntryPath,
    bootstrapSource,
    jsAssets,
    outDir,
  };
}

describe.sequential('verification bootstrap bundle', () => {
  beforeAll(async () => {
    artifacts = await buildVerificationArtifacts();
  }, 120_000);

  afterAll(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('keeps pre-verification dynamic imports limited to app and mock-worker chunks', () => {
    if (!artifacts) {
      throw new Error('expected verification build artifacts');
    }

    const dynamicImports = Array.from(
      artifacts.bootstrapSource.matchAll(/import\("\.\/([^"]+\.js)"\)/gu),
      (match) => match[1]
    );

    expect(dynamicImports).toHaveLength(2);
    expect(dynamicImports.some((value) => value.startsWith('main-'))).toBe(true);
    expect(dynamicImports.some((value) => value.startsWith('browser-'))).toBe(true);
  });

  it('bundles the noble fallback into the trusted bootstrap entry', async () => {
    if (!artifacts) {
      throw new Error('expected verification build artifacts');
    }

    const assetsWithNobleCode: string[] = [];
    for (const assetPath of artifacts.jsAssets) {
      const source = await readFile(assetPath, 'utf8');
      if (hasNobleMarker(source)) {
        assetsWithNobleCode.push(assetPath);
      }
    }

    expect(assetsWithNobleCode).toEqual([artifacts.bootstrapEntryPath]);
  });
});
