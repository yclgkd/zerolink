# Current Session State

*Last updated: 2026-03-06*

## Active Task
CI/CD dual-environment automation (staging + production).

## Current Status
- **Phase**: PR review
- **Progress**: Staging environment fully bootstrapped; deploy.yml rewritten; awaiting PR merge.
- **Blocking Issues**: None

## What Was Done
- Created staging KV namespace (`1a3fb3548446479a8f401d8bb54de4c0`)
- Updated `packages/backend/wrangler.toml` with `[env.staging]` block
- Deployed `zerolink-api-staging` worker, set `RP_ID`/`RP_ORIGIN` secrets via `wrangler secret put`
- Deployed staging frontend to Cloudflare Pages (`zerolink` project, `staging` branch)
- Rewrote `.github/workflows/deploy.yml`:
  - `push: branches: main` → staging deploy
  - `push: tags: v*` → production deploy
  - Added `test` job gate (typecheck + tests) before deploy
  - Removed `--var RP_ID/RP_ORIGIN` (secrets live in CF Dashboard)
  - Fixed Pages project name: `zerolink-frontend` → `zerolink`
  - Both staging and production sign manifest

## Files Recently Modified
| File | Status | Notes |
|------|--------|-------|
| `packages/backend/wrangler.toml` | updated | Added `[env.staging]` block |
| `.github/workflows/deploy.yml` | rewritten | Dual-env CI/CD |

## Next Steps
1. [ ] Merge PR (squash)
2. [ ] Tag a release when ready: `git tag v0.1.0 && git push origin v0.1.0`

## Key Context to Preserve
- Staging: `zerolink-api-staging` worker + `staging` Pages branch → `staging.zerolink.yaochunlai.com`
- Production: `zerolink-api` worker + `main` Pages branch → `zerolink.yaochunlai.com`
- RP_ID/RP_ORIGIN set via CF Dashboard, NOT in GitHub Secrets or wrangler.toml
- GitHub Secrets hold: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `MANIFEST_SIGNING_KEY`
