import { createPrivateKey, sign as signData } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DIST_DIR = path.resolve(REPO_ROOT, 'packages', 'frontend', 'dist');
const MANIFEST_PATH = path.resolve(DIST_DIR, 'manifest.json');
const SIGNATURE_PATH = path.resolve(DIST_DIR, 'manifest.sig');
const SIGNING_KEY_ENV = 'MANIFEST_SIGNING_KEY' as const;

export function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function getSigningKeyPem(): string {
  const value = process.env[SIGNING_KEY_ENV];
  if (!value || value.trim().length === 0) {
    throw new Error(`${SIGNING_KEY_ENV} is required`);
  }
  return value;
}

async function run(): Promise<void> {
  const manifestBytes = await fs.readFile(MANIFEST_PATH);
  const privateKeyPem = getSigningKeyPem();
  const privateKey = createPrivateKey(privateKeyPem);

  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `Expected Ed25519 signing key, got ${privateKey.asymmetricKeyType ?? 'unknown'}`
    );
  }

  const signature = signData(null, manifestBytes, privateKey);
  const signatureBase64Url = toBase64Url(signature);

  await fs.writeFile(SIGNATURE_PATH, `${signatureBase64Url}\n`, 'utf8');
  process.stdout.write(
    `manifest signature generated: ${path.relative(REPO_ROOT, SIGNATURE_PATH)}\n`
  );
}

if (process.argv[1] === SCRIPT_FILE) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`sign-manifest failed: ${message}\n`);
    process.exitCode = 1;
  });
}
