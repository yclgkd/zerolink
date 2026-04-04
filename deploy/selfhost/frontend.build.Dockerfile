FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN HUSKY=0 pnpm install --frozen-lockfile --ignore-scripts

COPY packages/frontend ./packages/frontend
COPY packages/shared ./packages/shared

RUN pnpm --filter @zerolink/frontend build

FROM caddy:2.8-alpine

COPY deploy/selfhost/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/packages/frontend/dist /srv/frontend
