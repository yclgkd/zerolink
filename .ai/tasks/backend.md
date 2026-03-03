# Backend Tasks

## Primary Paths
- `packages/backend/`
- `packages/shared/`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`

## Guardrails
- Preserve Durable Object ordering and terminal-state guarantees.
- Do not move secret handling to the server.
- Reuse shared schemas and constants instead of redefining protocol contracts.
- Be explicit about deletion, expiration, and state-machine behavior.

## Validation
```bash
pnpm --filter @zerolink/backend typecheck
pnpm --filter @zerolink/backend test
pnpm --filter @zerolink/shared typecheck
pnpm --filter @zerolink/shared test
```
