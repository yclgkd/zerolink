import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

type ManifestFiles = Record<string, string>;

interface SignedManifest {
  version: string;
  commitHash: string;
  buildTime: string;
  files: ManifestFiles;
}

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const FRONTEND_DIR = path.resolve(REPO_ROOT, 'packages', 'frontend');
const DIST_DIR = path.resolve(FRONTEND_DIR, 'dist');
const MANIFEST_PATH = path.resolve(DIST_DIR, 'manifest.json');
const MANIFEST_HASH_PATH = path.resolve(DIST_DIR, 'manifest-hash.txt');
const SIGNATURE_PATH = path.resolve(DIST_DIR, 'manifest.sig');

export async function collectFilePaths(rootDir: string): Promise<string[]> {
  const result: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.resolve(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolutePath);
          return;
        }
        if (!entry.isFile()) {
          return;
        }
        if (
          absolutePath === MANIFEST_PATH ||
          absolutePath === MANIFEST_HASH_PATH ||
          absolutePath === SIGNATURE_PATH
        ) {
          return;
        }
        result.push(absolutePath);
      })
    );
  }

  await walk(rootDir);
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

export async function hashFileHex(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export function toPosixRelativePath(absolutePath: string, rootDir: string): string {
  return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

function readFrontendVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(FRONTEND_DIR, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

async function generateManifest(): Promise<SignedManifest> {
  const filePaths = await collectFilePaths(DIST_DIR);
  const entries = await Promise.all(
    filePaths.map(async (filePath) => {
      const relativePath = toPosixRelativePath(filePath, DIST_DIR);
      const hash = await hashFileHex(filePath);
      return [relativePath, hash] as const;
    })
  );
  const files: ManifestFiles = Object.fromEntries(entries);

  return {
    version: readFrontendVersion(),
    commitHash: readCommitHash(),
    buildTime: new Date().toISOString(),
    files,
  };
}

async function run(): Promise<void> {
  const distStat = await fs.stat(DIST_DIR).catch(() => null);
  if (!distStat || !distStat.isDirectory()) {
    throw new Error('frontend dist directory not found; run pnpm build first');
  }

  const manifest = await generateManifest();
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  await fs.writeFile(MANIFEST_PATH, manifestJson, 'utf8');

  const manifestHash = createHash('sha256').update(manifestJson, 'utf8').digest('hex');
  await fs.writeFile(MANIFEST_HASH_PATH, `${manifestHash}\n`, 'utf8');

  process.stdout.write(`manifest generated: ${path.relative(REPO_ROOT, MANIFEST_PATH)}\n`);
  process.stdout.write(
    `manifest hash generated: ${path.relative(REPO_ROOT, MANIFEST_HASH_PATH)}\n`
  );
}

if (process.argv[1] === SCRIPT_FILE) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`generate-manifest failed: ${message}\n`);
    process.exitCode = 1;
  });
}
