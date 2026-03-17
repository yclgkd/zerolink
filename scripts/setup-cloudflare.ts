/**
 * Interactive Cloudflare setup script.
 *
 * Automates the post-deploy manual steps:
 *   1. Creates KV namespace(s) and patches wrangler.toml with the new ID(s)
 *   2. Auto-generates COMMIT_TOKEN_SECRET (random 32-byte hex)
 *   3. Prompts for RP_ID and RP_ORIGIN, then pushes all three as Worker secrets
 *
 * Usage:
 *   pnpm setup
 *   npx tsx scripts/setup-cloudflare.ts
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_FILE), '..');
const BACKEND_DIR = path.resolve(REPO_ROOT, 'packages/backend');
const WRANGLER_TOML = path.resolve(BACKEND_DIR, 'wrangler.toml');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function out(msg: string): void {
  process.stdout.write(msg);
}

function runWrangler(args: string, stdin?: string): { ok: boolean; output: string } {
  const result = spawnSync(`npx wrangler ${args}`, {
    shell: true,
    cwd: BACKEND_DIR,
    input: stdin,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    output: (result.stdout ?? '') + (result.stderr ?? ''),
  };
}

function extractKvId(output: string): string | null {
  // Matches: id = "abc123..." or id: "abc123..."
  const match = output.match(/["']?id["']?\s*[=:]\s*["']([a-f0-9]{32})["']/);
  return match ? match[1] : null;
}

function patchKvId(toml: string, id: string, isStaging: boolean): string {
  if (isStaging) {
    return toml.replace(
      /(\[\[env\.staging\.kv_namespaces\]\]\nbinding = "SECRETS_KV"\nid = ")[^"]+(")/,
      `$1${id}$2`
    );
  }
  return toml.replace(
    /(\[\[kv_namespaces\]\]\nbinding = "SECRETS_KV"\nid = ")[^"]+(")/,
    `$1${id}$2`
  );
}

// ---------------------------------------------------------------------------
// Setup logic for one environment
// ---------------------------------------------------------------------------

interface EnvConfig {
  label: string;
  wranglerFlag: string;
  isStaging: boolean;
  rpId: string;
  rpOrigin: string;
}

function setupEnv(cfg: EnvConfig): boolean {
  const flag = cfg.wranglerFlag ? ` ${cfg.wranglerFlag}` : '';
  let tomlPatched = false;

  out(`\n📦 Setting up ${cfg.label}...\n`);

  // KV namespace
  out('  Creating KV namespace... ');
  const kv = runWrangler(`kv:namespace create SECRETS_KV${flag}`);
  if (kv.ok) {
    const kvId = extractKvId(kv.output);
    if (kvId) {
      const toml = readFileSync(WRANGLER_TOML, 'utf8');
      writeFileSync(WRANGLER_TOML, patchKvId(toml, kvId, cfg.isStaging));
      tomlPatched = true;
      out(`✅  (${kvId})\n`);
    } else {
      out('created but could not parse ID — patch wrangler.toml manually\n');
    }
  } else if (kv.output.includes('already exist') || kv.output.includes('already exists')) {
    out('already exists, skipping\n');
  } else {
    out(`⚠️  ${kv.output.trim().split('\n')[0]}\n`);
  }

  // COMMIT_TOKEN_SECRET — auto-generated
  out('  Setting COMMIT_TOKEN_SECRET... ');
  const secret = randomBytes(32).toString('hex');
  const putSecret = runWrangler(`secret put COMMIT_TOKEN_SECRET${flag}`, `${secret}\n`);
  out(putSecret.ok ? '✅\n' : `⚠️  ${putSecret.output.trim().split('\n')[0]}\n`);

  // RP_ID
  out('  Setting RP_ID... ');
  const putRpId = runWrangler(`secret put RP_ID${flag}`, `${cfg.rpId}\n`);
  out(putRpId.ok ? '✅\n' : `⚠️  ${putRpId.output.trim().split('\n')[0]}\n`);

  // RP_ORIGIN
  out('  Setting RP_ORIGIN... ');
  const putRpOrigin = runWrangler(`secret put RP_ORIGIN${flag}`, `${cfg.rpOrigin}\n`);
  out(putRpOrigin.ok ? '✅\n' : `⚠️  ${putRpOrigin.output.trim().split('\n')[0]}\n`);

  return tomlPatched;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  out('🚀 ZeroLink Cloudflare Setup\n\n');

  // Verify login
  out('Checking Wrangler login... ');
  const whoami = runWrangler('whoami');
  if (!whoami.ok) {
    process.stderr.write('\n❌ Not logged in. Run: npx wrangler login\n');
    process.exit(1);
  }
  out('✅\n');

  // Choose environment
  const envRaw =
    (
      await rl.question('\nEnvironment to set up (production / staging / both) [production]: ')
    ).trim() || 'production';
  const setupProd = envRaw === 'production' || envRaw === 'both';
  const setupStaging = envRaw === 'staging' || envRaw === 'both';

  // Production RP config
  out('\nWebAuthn configuration for production:\n');
  const rpId = (
    await rl.question('  RP_ID    (domain without https://, e.g. zerolink.dev): ')
  ).trim();
  const rpOrigin = (
    await rl.question('  RP_ORIGIN (full URL,   e.g. https://zerolink.dev): ')
  ).trim();

  // Staging RP config (optional override)
  let stagingRpId = rpId;
  let stagingRpOrigin = rpOrigin;
  if (setupStaging) {
    out('\nWebAuthn configuration for staging (Enter to reuse production values):\n');
    stagingRpId = (await rl.question(`  RP_ID    [${rpId}]: `)).trim() || rpId;
    stagingRpOrigin = (await rl.question(`  RP_ORIGIN [${rpOrigin}]: `)).trim() || rpOrigin;
  }

  rl.close();

  let tomlChanged = false;

  if (setupProd) {
    const patched = setupEnv({
      label: 'production',
      wranglerFlag: '',
      isStaging: false,
      rpId,
      rpOrigin,
    });
    tomlChanged = tomlChanged || patched;
  }

  if (setupStaging) {
    const patched = setupEnv({
      label: 'staging',
      wranglerFlag: '--env staging',
      isStaging: true,
      rpId: stagingRpId,
      rpOrigin: stagingRpOrigin,
    });
    tomlChanged = tomlChanged || patched;
  }

  out('\n🎉 Setup complete!\n');
  if (tomlChanged) {
    out(
      '\n⚠️  wrangler.toml was updated with new KV namespace IDs.\n' +
        '   Commit and push this change before deploying:\n' +
        '     git add packages/backend/wrangler.toml\n' +
        '     git commit -m "chore: update KV namespace IDs"\n'
    );
  }
  out('\nNext step: pnpm build && cd packages/backend && npx wrangler deploy\n');
}

if (process.argv[1] === SCRIPT_FILE) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`setup-cloudflare failed: ${message}\n`);
    process.exitCode = 1;
  });
}
