# Commands

## Root
```bash
pnpm dev
pnpm build
pnpm test
pnpm test:e2e
pnpm test:e2e:mock
pnpm test:e2e:realtime
pnpm typecheck
pnpm lint
pnpm manifest:generate
pnpm manifest:sign
pnpm manifest:verify
```

## Frontend
```bash
pnpm --filter @zerolink/frontend dev
pnpm --filter @zerolink/frontend build
pnpm --filter @zerolink/frontend test
pnpm --filter @zerolink/frontend typecheck
pnpm --filter @zerolink/frontend test:e2e
pnpm --filter @zerolink/frontend test:e2e:mock
pnpm --filter @zerolink/frontend test:e2e:realtime
```

## Backend
```bash
pnpm --filter @zerolink/backend dev
pnpm --filter @zerolink/backend test
pnpm --filter @zerolink/backend typecheck
pnpm --filter @zerolink/backend deploy
```

## Shared
```bash
pnpm --filter @zerolink/shared test
pnpm --filter @zerolink/shared typecheck
```

## Self-Hosted API (Go)
```bash
cd services/selfhost-api
make run              # start API server
make migrate          # run DB migrations
make test             # go test ./...
make test-race        # go test -race ./...
make sqlc-generate    # regenerate sqlc queries
```
