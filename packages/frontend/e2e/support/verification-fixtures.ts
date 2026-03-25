/**
 * Dynamic fixture builder for E2E verification happy-path tests.
 *
 * Fetches real built assets from the preview server, computes their SHA-256
 * hashes, constructs a valid manifest, and signs it with the test-only
 * Ed25519 private key committed alongside this file.
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_PRIVATE_KEY_PEM = readFileSync(path.join(__dirname, 'e2e-test-signing.key'), 'utf8');

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function signEd25519Base64Url(data: Buffer): string {
  const privateKey = createPrivateKey(TEST_PRIVATE_KEY_PEM);
  const sig = sign(null, data, privateKey);
  return sig.toString('base64url');
}

export interface VerificationFixtures {
  readonly manifestJson: string;
  readonly signature: string;
  readonly manifestHash: string;
}

/**
 * Builds a cryptographically valid manifest + signature for the preview build.
 *
 * 1. Fetches the HTML from the preview server to discover the entry script path
 * 2. Fetches the entry script asset to compute its real SHA-256 hash
 * 3. Constructs a ReleaseManifest JSON and signs it with the test private key
 */
export async function buildSignedManifestForPreview(
  baseUrl: string
): Promise<VerificationFixtures> {
  let htmlResponse: Response;
  try {
    htmlResponse = await fetch(baseUrl);
  } catch (error) {
    throw new Error(
      `Failed to fetch HTML from ${baseUrl} — is the preview server running? (${error instanceof Error ? error.message : String(error)})`
    );
  }
  if (!htmlResponse.ok) {
    throw new Error(`Preview server returned HTTP ${htmlResponse.status} for ${baseUrl}`);
  }
  const html = await htmlResponse.text();

  // Extract the entry script src from <script type="module" ...src="...">
  const scriptMatch = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/);
  if (!scriptMatch) {
    throw new Error('Could not find module script in HTML — is the preview server running?');
  }
  const entryScriptSrc = scriptMatch[1]; // e.g. "/assets/bootstrap-entry-abc123.js"
  const entryAssetPath = entryScriptSrc.startsWith('/') ? entryScriptSrc.slice(1) : entryScriptSrc;

  // Fetch the entry script to get its real content hash
  const entryUrl = new URL(entryScriptSrc, baseUrl).href;
  const entryResponse = await fetch(entryUrl);
  if (!entryResponse.ok) {
    throw new Error(`Failed to fetch entry script at ${entryUrl} — HTTP ${entryResponse.status}`);
  }
  const entryBytes = Buffer.from(await entryResponse.arrayBuffer());
  const entryHash = sha256Hex(entryBytes);

  const manifest = {
    version: '0.0.0-e2e-test',
    commitHash: `e2e-test-commit-${'a'.repeat(24)}`,
    buildTime: new Date().toISOString(),
    entryAssetPath,
    files: {
      [entryAssetPath]: entryHash,
    },
  };

  const manifestJson = JSON.stringify(manifest);
  const manifestBuffer = Buffer.from(manifestJson, 'utf8');
  const signature = signEd25519Base64Url(manifestBuffer);
  const manifestHash = sha256Hex(manifestBuffer);

  return { manifestJson, signature, manifestHash };
}
