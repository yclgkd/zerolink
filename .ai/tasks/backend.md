# Backend Tasks

## Primary Paths
- `packages/backend/` — Cloudflare Worker (hosted)
- `services/selfhost-api/` — Go API (self-hosted)
- `packages/shared/`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`

## Guardrails
- Preserve Durable Object ordering and terminal-state guarantees (hosted) / advisory-lock transaction guarantees (self-hosted).
- Do not move secret handling to the server.
- Reuse shared schemas and constants instead of redefining protocol contracts.
- Be explicit about deletion, expiration, and state-machine behavior.
- Self-hosted protocol surfaces must stay contract-compatible with the hosted Worker (see `docs/SELF_HOSTED_CONTRACT.md`).

## Validation — Hosted (TypeScript)
```bash
pnpm --filter @zerolink/backend typecheck
pnpm --filter @zerolink/backend test
pnpm --filter @zerolink/shared typecheck
pnpm --filter @zerolink/shared test
```

## Validation — Self-Hosted (Go)
```bash
cd services/selfhost-api
make test
make test-race
```
