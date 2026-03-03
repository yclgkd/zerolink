# Commands

## Root
```bash
pnpm dev
pnpm build
pnpm test
pnpm test:e2e
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
