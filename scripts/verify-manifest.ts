import { createHash, createPublicKey, verify as verifyData } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DIST_DIR = path.resolve(REPO_ROOT, 'packages', 'frontend', 'dist');
const MANIFEST_PATH = path.resolve(DIST_DIR, 'manifest.json');
const MANIFEST_HASH_PATH = path.resolve(DIST_DIR, 'manifest-hash.txt');
const SIGNATURE_PATH = path.resolve(DIST_DIR, 'manifest.sig');
const PUBLIC_KEY_PATH = path.resolve(REPO_ROOT, 'keys', 'manifest-signing.pub');

type ManifestFiles = Record<string, string>;

interface Manifest {
  version: string;
  commitHash: string;
  buildTime: string;
  files: ManifestFiles;
}

export function fromBase64Url(encoded: string): Buffer {
  const padded =
    encoded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (encoded.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export function hashBufferHex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function verifyManifestSignature(opts: {
  manifestBytes: Buffer;
  signatureBase64Url: string;
  publicKeyPem: string;
}): Promise<boolean> {
  const { manifestBytes, signatureBase64Url, publicKeyPem } = opts;
  const publicKey = createPublicKey(publicKeyPem);
  const signature = fromBase64Url(signatureBase64Url.trim());
  return verifyData(null, manifestBytes, publicKey, signature);
}

export async function verifyFileHashes(
  manifest: Manifest,
  distDir: string
): Promise<{ path: string; expected: string; actual: string; ok: boolean }[]> {
  const distDirBoundary = distDir.endsWith(path.sep) ? distDir : distDir + path.sep;

  return Promise.all(
    Object.entries(manifest.files).map(async ([relativePath, expected]) => {
      // Reject absolute paths, traversal segments, and empty segments before resolving.
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

async function run(): Promise<void> {
  process.stdout.write('ZeroLink — Build Manifest Verifier\n');
  process.stdout.write(`${'='.repeat(50)}\n\n`);

  // 1. Read artifacts
  const [manifestBytes, signatureLine, publicKeyPem] = await Promise.all([
    fs.readFile(MANIFEST_PATH).catch(() => null),
    fs.readFile(SIGNATURE_PATH, 'utf8').catch(() => null),
    fs.readFile(PUBLIC_KEY_PATH, 'utf8').catch(() => null),
  ]);

  if (!manifestBytes) {
    process.stderr.write(
      `ERROR: manifest.json not found at ${path.relative(REPO_ROOT, MANIFEST_PATH)}\n`
    );
    process.stderr.write('Run: pnpm manifest:generate\n');
    process.exitCode = 1;
    return;
  }
  if (!signatureLine) {
    process.stderr.write(
      `ERROR: manifest.sig not found at ${path.relative(REPO_ROOT, SIGNATURE_PATH)}\n`
    );
    process.stderr.write('Run: pnpm manifest:sign\n');
    process.exitCode = 1;
    return;
  }
  if (!publicKeyPem) {
    process.stderr.write(
      `ERROR: public key not found at ${path.relative(REPO_ROOT, PUBLIC_KEY_PATH)}\n`
    );
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Manifest;

  // 2. Verify signature
  process.stdout.write('[1/2] Verifying Ed25519 signature...\n');
  const signatureValid = await verifyManifestSignature({
    manifestBytes,
    signatureBase64Url: signatureLine,
    publicKeyPem,
  });

  if (!signatureValid) {
    process.stderr.write('FAIL  Signature verification failed.\n');
    process.stderr.write('      The manifest may have been tampered with.\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write('PASS  Signature is valid.\n\n');

  // 3. Verify file hashes
  process.stdout.write('[2/2] Verifying file hashes...\n');
  const results = await verifyFileHashes(manifest, DIST_DIR);
  const failures = results.filter((r) => !r.ok);

  for (const result of results) {
    const icon = result.ok ? 'PASS' : 'FAIL';
    process.stdout.write(`${icon}  ${result.path}\n`);
    if (!result.ok) {
      process.stdout.write(`      expected: ${result.expected}\n`);
      process.stdout.write(`      actual:   ${result.actual}\n`);
    }
  }

  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} file(s) failed hash verification.\n`);
    process.exitCode = 1;
    return;
  }

  // 4. Confirm manifest hash
  const manifestHashExpected = (
    await fs.readFile(MANIFEST_HASH_PATH, 'utf8').catch(() => '')
  ).trim();
  const manifestHashActual = hashBufferHex(manifestBytes);

  process.stdout.write('\nManifest hash:\n');
  process.stdout.write(`  ${manifestHashActual}\n`);
  if (manifestHashExpected.length > 0 && manifestHashExpected !== manifestHashActual) {
    process.stderr.write(
      `WARNING: manifest-hash.txt (${manifestHashExpected}) does not match computed hash.\n`
    );
  }

  process.stdout.write('\nAll checks passed. Build integrity verified.\n');
  process.stdout.write(`\nBuild info:\n`);
  process.stdout.write(`  version:    ${manifest.version}\n`);
  process.stdout.write(`  commitHash: ${manifest.commitHash}\n`);
  process.stdout.write(`  buildTime:  ${manifest.buildTime}\n`);
}

if (process.argv[1] === SCRIPT_FILE) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`verify-manifest failed: ${message}\n`);
    process.exitCode = 1;
  });
}
