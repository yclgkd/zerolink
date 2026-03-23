/**
 * Interactive Cloudflare setup script.
 *
 * Automates the post-deploy manual steps:
 *   1. Auto-generates COMMIT_TOKEN_SECRET (random 32-byte hex)
 *   2. Prompts for RP_ID and RP_ORIGIN, then pushes all three as Worker secrets
 *
 * Usage:
 *   pnpm setup
 *   npx tsx scripts/setup-cloudflare.ts
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_FILE), '..');
const BACKEND_DIR = path.resolve(REPO_ROOT, 'packages/backend');

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

// ---------------------------------------------------------------------------
// Setup logic for one environment
// ---------------------------------------------------------------------------

interface EnvConfig {
  label: string;
  wranglerFlag: string;
  rpId: string;
  rpOrigin: string;
}

function setupEnv(cfg: EnvConfig): void {
  const flag = cfg.wranglerFlag ? ` ${cfg.wranglerFlag}` : '';

  out(`\n📦 Setting up ${cfg.label}...\n`);

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

  // Primary RP config
  const primaryLabel = setupProd ? 'production' : 'staging';
  out(`\nWebAuthn configuration for ${primaryLabel}:\n`);
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

  if (setupProd) {
    setupEnv({
      label: 'production',
      wranglerFlag: '',
      rpId,
      rpOrigin,
    });
  }

  if (setupStaging) {
    setupEnv({
      label: 'staging',
      wranglerFlag: '--env staging',
      rpId: stagingRpId,
      rpOrigin: stagingRpOrigin,
    });
  }

  out('\n🎉 Setup complete!\n');
  out('\nNext steps:\n');
  out('  1. pnpm --filter @zerolink/frontend build\n');
  out('  2. cd packages/backend\n');
  if (setupProd) {
    out('  3. Deploy production: npx wrangler deploy --env=""\n');
  }
  if (setupStaging) {
    out('  3. Deploy staging:    npx wrangler deploy --env staging\n');
  }
}

if (process.argv[1] === SCRIPT_FILE) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`setup-cloudflare failed: ${message}\n`);
    process.exitCode = 1;
  });
}
