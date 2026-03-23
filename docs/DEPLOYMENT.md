> **Language**: English | [中文](./DEPLOYMENT.zh.md)

# ZeroLink Deployment Guide

> This document covers the complete steps to deploy ZeroLink to Cloudflare.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Quick Deploy](#quick-deploy)
4. [Manual Deploy](#manual-deploy)
5. [Environment Variables](#environment-variables)
6. [Manifest Signing (Optional)](#manifest-signing-optional)
7. [Custom Domain](#custom-domain)
8. [CI/CD Automated Deployment](#cicd-automated-deployment)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Description | Minimum Version |
|-------------|-------------|-----------------|
| Cloudflare Account | Free plan is sufficient (supports Durable Objects free tier) | — |
| Node.js | JavaScript runtime | 22.x |
| pnpm | Package manager | 9.x |
| Wrangler CLI | Official Cloudflare deployment tool | 4.x |

> **Important**: Durable Objects now offer a **Free Tier**. This project uses the **SQLite backend**, which is supported on the free plan (100k daily requests).

Install Wrangler CLI:
```bash
npm install -g wrangler
```

---

## Architecture Overview

```
User Browser                Cloudflare Edge
───────────            ──────────────────────────────────────
Frontend SPA    ──→    Worker (zerolink-api)
  + API requests        │  ├─ run_worker_first = true
                        │  ├─ Injects security response headers
                        │  ├─ /api/* → Business logic
                        │  └─ Other paths → Workers Assets (static files)
                        │
                        │
                   Durable Object
                   (SecretVault)
                   [State machine
                    / SQLite]
```

- **Cloudflare Worker**: Handles all requests (API + static files) and injects security response headers
- **Workers Assets**: Built-in static asset hosting within the Worker; static asset requests are free and unlimited
- **Durable Object**: Atomic state machine for each Secret (SQLite backend)

> **Architecture Note**: This project uses the **Workers Assets unified deployment** model, not
> Cloudflare Pages. Frontend build artifacts are deployed alongside the Worker via the `[assets]`
> binding in `wrangler.toml`. Security response headers are injected uniformly by the Worker code,
> eliminating the need for `_headers` / `_redirects` files.

---

## Quick Deploy

### One-Click Deploy

Click the button below to deploy ZeroLink Worker (including frontend assets) to your Cloudflare account:

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-F4801A?style=for-the-badge&logo=cloudflare&logoColor=white)](https://deploy.cloudflare.com/?url=https://github.com/yclgkd/ZeroLink)

> **Note**: After one-click deployment, run the interactive setup script to complete the remaining configuration:
>
> ```bash
> pnpm setup
> ```
>
> The script auto-generates `COMMIT_TOKEN_SECRET`. You only need to manually enter `RP_ID` and
> `RP_ORIGIN` (domain-related values that cannot be inferred automatically).

---

## Manual Deploy

### Step 1: Log in to Wrangler

```bash
npx wrangler login
```

### Step 2: Run the setup script

```bash
pnpm setup
```

The script interactively performs the following:
- Automatically generates and sets `COMMIT_TOKEN_SECRET`
- Prompts for `RP_ID` and `RP_ORIGIN`, setting them as Worker Secrets

```
🚀 ZeroLink Cloudflare Setup

Checking Wrangler login... ✅

Environment to set up (production / staging / both) [production]: production

WebAuthn configuration for production:
  RP_ID    (domain without https://, e.g. zerolink.dev): zerolink.dev
  RP_ORIGIN (full URL,   e.g. https://zerolink.dev): https://zerolink.dev

📦 Setting up production...
  Setting COMMIT_TOKEN_SECRET... ✅
  Setting RP_ID... ✅
  Setting RP_ORIGIN... ✅

🎉 Setup complete!
```

### Step 3: Build the frontend

```bash
pnpm --filter frontend build
# Build output is in packages/frontend/dist/
```

The default `pnpm build` output is a runnable but **unverified** frontend shell. It does not enable
the fail-closed `Verified Release` startup gate, making it suitable for local preview and unsigned
manual deployments.

### Step 4: Verify wrangler.toml configuration

Key configuration in `packages/backend/wrangler.toml`:

```toml
name = "zerolink-api"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[assets]
directory = "../frontend/dist"
binding = "ASSETS"
run_worker_first = true
not_found_handling = "single-page-application"

routes = [
  { pattern = "zerolink.dev", zone_name = "zerolink.dev" },
  { pattern = "zerolink.dev/*", zone_name = "zerolink.dev" },
]

[[durable_objects.bindings]]
name = "SECRET_VAULT"
class_name = "SecretVaultV2"
```

### Step 5: Deploy

```bash
cd packages/backend
npx wrangler deploy
```

A single command deploys both the Worker code and frontend static assets.

> **WebAuthn Note**:
> - `RP_ID` = your domain (without protocol prefix), e.g. `zerolink.dev`
> - `RP_ORIGIN` = full Origin URL, e.g. `https://zerolink.dev`
> - If using `*.workers.dev`, then `RP_ID=your-worker.username.workers.dev`
> - These two values must exactly match the actual access domain, otherwise WebAuthn authentication will fail

### Step 6: Verify deployment

```bash
# View Worker logs
npx wrangler tail

# Verify the Worker is reachable (should return a JSON response)
curl -s https://zerolink.dev/api/public/00000000-0000-0000-0000-000000000000 | head -c 200
```

---

## Environment Variables

### Worker Runtime Variables (configured in Cloudflare Dashboard)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `RP_ID` | Yes | WebAuthn Relying Party ID (domain, without protocol) | `zerolink.dev` |
| `RP_ORIGIN` | Yes | WebAuthn Origin (full URL) | `https://zerolink.dev` |
| `COMMIT_TOKEN_SECRET` | Yes | Commit Token HMAC key to prevent replay attacks (random 32-byte hex) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

### CI/CD Secrets (GitHub Actions)

| Secret Name | Description |
|-------------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (requires Worker permissions) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `MANIFEST_SIGNING_KEY` | Ed25519 private key (base64) for manifest signing |
| `RELEASE_PLEASE_TOKEN` | GitHub PAT or GitHub App token, used to create Release PRs, tags, and GitHub Releases, and to ensure subsequent workflows are triggered correctly; if missing, the release-please workflow will fail at the pre-check step with a configuration hint |

### Creating a Cloudflare API Token

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **My Profile > API Tokens > Create Token**
3. Select the **Edit Cloudflare Workers** template
4. Copy the Token and save it to GitHub Secrets

---

## Manifest Signing (Optional)

ZeroLink supports Ed25519 signing of frontend build artifacts for users to verify integrity. Only
builds that explicitly enable `VITE_RELEASE_VERIFICATION_REQUIRED=true` and also publish signed
artifacts will activate the fail-closed `Verified Release` startup check in the browser.

### Generate Key Pair

```bash
# Generate Ed25519 key using OpenSSL
openssl genpkey -algorithm ed25519 -out keys/manifest-signing.pem
openssl pkey -in keys/manifest-signing.pem -pubout -out keys/manifest-signing.pub

# Save the PEM text content directly as the GitHub Secret MANIFEST_SIGNING_KEY
cat keys/manifest-signing.pem
```

> The private key (`.pem`) is excluded in `.gitignore`. **Never commit it to git**.

### Local Signing Flow

```bash
# Build
VITE_RELEASE_VERIFICATION_REQUIRED=true pnpm --filter frontend build

# Generate manifest (records `entryAssetPath` and hashes only the stable runtime
# assets under `dist/assets/`; root-level files like `index.html` and `robots.txt`
# are not included in the signed set)
pnpm manifest:generate

# Sign manifest
MANIFEST_SIGNING_KEY="$(cat keys/manifest-signing.pem)" \
  pnpm manifest:sign

# Verify signature
pnpm manifest:verify
```

The caching strategy is controlled uniformly by the Worker code: SPA entry requests return
`Cache-Control: no-store`, while hashed `/assets/*` files use long-term immutable caching
(`public, max-age=31536000, immutable`). The signed manifest covers only the stable runtime
artifacts under `dist/assets/`, not root-level files like `index.html`. The generated
`manifest.json` records the entry bundle that should be executed (`entryAssetPath`); the
browser-side bootstrap verifies that the currently running entry asset matches the manifest. If
there is a mismatch, it first triggers a controlled refresh; if the mismatch persists, it
fail-closes and blocks execution.

---

## Custom Domain

Configure routes in `wrangler.toml` so the Worker handles all requests (API + static assets) for your domain:

```toml
routes = [
  { pattern = "zerolink.dev", zone_name = "zerolink.dev" },
  { pattern = "zerolink.dev/*", zone_name = "zerolink.dev" },
]
```

Or via the Cloudflare Dashboard: **Workers > zerolink-api > Settings > Domains & Routes > Add**

> **Note**: Two separate route entries are used — one for the bare root (`zerolink.dev`) and one for all sub-paths (`zerolink.dev/*`) — to ensure the root path `/` is matched correctly.

---

## CI/CD Automated Deployment

The project includes a standalone deployment workflow `.github/workflows/deploy.yml` that supports:
- Automatic staging deployment on `push` to `main` when workflow trigger conditions are met
- Automatic production deployment on `v*` tag push when workflow trigger conditions are met

Workflow execution order: `install > build frontend > generate manifest > sign manifest > verify manifest > wrangler deploy`

A separate `.github/workflows/release-please.yml` workflow is responsible for generating or updating Release PRs on `main`. This workflow first pre-checks `RELEASE_PLEASE_TOKEN`, then runs the commit-pinned official `release-please` action. The current upstream action still declares `runs: node20`, so GitHub may show a Node 20 deprecation warning; ZeroLink does not work around this warning by installing npm packages at runtime, and will update the pin once the upstream action upgrades. After merging a Release PR, Release Please will:
- Update `version.txt` in the root directory
- Maintain the root `CHANGELOG.md`
- Create a new `v*` tag and GitHub Release
- Trigger the existing production deploy workflow via that tag

Version source conventions:
- Production builds use the git tag as the sole release version source; `v1.2.3` is injected as `ZEROLINK_VERSION=1.2.3`
- Staging builds always inject `ZEROLINK_VERSION=0.0.0-dev+<short_sha>`, used to track deployment origin in the `Verified Release` card and `manifest.json`
- The `version` field in `packages/frontend/package.json` serves only as a fallback for local/un-injected environments and no longer represents the official release version

### Configuration Steps

1. Add all required Secrets in the GitHub repository under Settings > Secrets and variables > Actions
2. Push a `v*` tag to trigger automatic deployment:

```bash
git tag v1.0.0
git push origin v1.0.0
```

3. The current workflow does not have `workflow_dispatch`; to manually re-trigger, push the corresponding branch or tag again
4. In the GitHub repository under **Settings > Actions > General**, enable **Allow GitHub Actions to create and approve pull requests**
5. Use `RELEASE_PLEASE_TOKEN` (PAT or GitHub App token); do not fall back to the default `GITHUB_TOKEN`, otherwise PRs/tags created by Release Please will not trigger subsequent workflows by default
6. If `release-please.yml` fails with a `Missing RELEASE_PLEASE_TOKEN` annotation, add the secret as described above and re-run the workflow
7. If GitHub shows a Node 20 deprecation warning for this workflow, it is an upstream runtime warning from the official action, not a ZeroLink script error; the pin will be updated after the upstream action upgrades

### Release Please Commit Conventions

Under ZeroLink's current commitlint constraints, use `feat` / `fix` as releasable commit types. The repository reserves `security:` as a valid Conventional Commit type, but it **will not** automatically trigger a release.

To include security fixes in automatic version releases, use:

```text
fix(security): ...
feat(security): ...
```

Do not rely on bare `security:` commits to trigger a Release PR.

### Overriding the Release Version in Manual Builds

If you are manually generating signed release artifacts **with the verification gate enabled** outside of GitHub Actions, and want the version number in `manifest.json` to match an external release version, you can explicitly inject `ZEROLINK_VERSION`:

```bash
ZEROLINK_VERSION=1.0.0 VITE_RELEASE_VERIFICATION_REQUIRED=true \
  pnpm --filter frontend build
ZEROLINK_VERSION=1.0.0 pnpm manifest:generate
```

When this environment variable is not set, the manifest falls back to the version in `packages/frontend/package.json`.

---

## Troubleshooting

### Worker Returns `INTERNAL_ERROR` (DO Constructor Failure)

**Symptom**: All API requests return `{"ok":false,"code":"INTERNAL_ERROR"}`, and `wrangler tail` logs show:
```
Error: COMMIT_TOKEN_SECRET environment variable is missing or empty
  at new SecretVault (...)
```

**Solution**: Required Secrets are missing from the Cloudflare Dashboard. Check and add the following:
- `COMMIT_TOKEN_SECRET` (most commonly missed)
- `RP_ID`
- `RP_ORIGIN`

```bash
# View currently configured secrets
npx wrangler secret list --name zerolink-api-staging

# Add a missing secret (using COMMIT_TOKEN_SECRET as an example)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | \
  npx wrangler secret put COMMIT_TOKEN_SECRET --name zerolink-api-staging
```

> These three variables are validated at Worker startup; if any one is missing, the Durable Object constructor will fail and all requests will return 500.

---

### WebAuthn Authentication Failure

**Symptom**: Unable to create or verify passkeys

**Solution**:
- Verify that `RP_ID` exactly matches the access domain (without `https://`)
- Verify that `RP_ORIGIN` exactly matches the browser's Origin (including `https://`)
- WebAuthn does not support non-HTTPS domains other than `localhost`

### Durable Object Migration Failure

**Symptom**: Worker returns 500 errors with DO-related errors in logs

**Solution**:
```bash
# View real-time logs
npx wrangler tail zerolink-api

# Verify that the migrations configuration in wrangler.toml is correct
cat packages/backend/wrangler.toml
```

### Build Failure

```bash
# Clean cache and rebuild
rm -rf packages/*/dist
pnpm install --frozen-lockfile
pnpm build
```

### Static Asset 404

**Symptom**: Frontend page loads but JS/CSS and other assets return 404

**Solution**:
- Verify that the `packages/frontend/dist/` directory exists and contains build artifacts (run `pnpm --filter frontend build` first)
- Verify that `[assets] directory = "../frontend/dist"` in `wrangler.toml` is correct relative to `packages/backend/`
- `wrangler deploy` must be run after the frontend build is complete

---

## Related Docs

- [Quick Start Guide](./QUICK_START.md) - Local development environment setup
- [Tech Stack](./TECH_STACK.md) - Complete technology stack reference
- [Architecture Overview](./ARCHITECTURE.md) - System design
- [Security Model](./SECURITY.md) - Threat model and security guarantees

---

**Last Updated**: 2026-03-17
