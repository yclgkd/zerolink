# Release Tasks

## Primary Paths
- `.github/workflows/`
- `scripts/generate-manifest.ts`
- `scripts/sign-manifest.ts`
- `scripts/verify-manifest.ts`
- `docs/DEPLOYMENT.md`
- `keys/`

## Guardrails
- Keep release notes and PR text neutral and project-focused.
- Document validation, risk, and rollback in the PR.
- Do not skip manifest generation or verification when a change touches release flow.

## Validation
```bash
pnpm build
pnpm manifest:generate
pnpm manifest:verify
pnpm --filter @zerolink/backend typecheck
pnpm --filter @zerolink/frontend build
```
