FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable
ENV CI=true

COPY . .

RUN HUSKY=0 pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @zerolink/frontend build

FROM caddy:2.8-alpine

COPY deploy/selfhost/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/packages/frontend/dist /srv/frontend
