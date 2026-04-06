# Frontend Tasks

## Primary Paths
- `packages/frontend/`
- `packages/shared/`

## Guardrails
- Keep secret handling browser-side.
- Do not persist plaintext secrets beyond the required local encryption step.
- Reuse shared schemas and types.
- Prefer MSW-backed UI work when backend dependencies are not ready.

## Validation
```bash
pnpm --filter @zerolink/frontend typecheck
pnpm --filter @zerolink/frontend test
pnpm --filter @zerolink/frontend build
pnpm --filter @zerolink/frontend test:e2e
```
