> **Language**: English | [中文](./SELF_HOSTED_DEPLOYMENT.zh.md)

# Self-Hosted Deployment Guide

This guide packages the current ZeroLink frontend and Go self-hosted backend into a local Docker Compose stack.

## What This Stack Includes

- `web`: Caddy serving the built frontend and reverse-proxying `/api/*`
- `api`: Go self-hosted API
- `db`: PostgreSQL
- `migrate`: one-shot migration job

## Realtime Behavior

- `/api/ws/:uuid` is implemented for single-node self-host runs
- The frontend still keeps its existing `/api/public/:uuid` polling fallback
- Horizontal scaling is intentionally out of scope for this package; there is no Redis/shared pub-sub layer yet

## Start The Stack

```bash
cp deploy/selfhost/.env.example deploy/selfhost/.env
docker compose -f deploy/selfhost/docker-compose.yml up --build
```

Then open:

- App: `http://localhost:8080`
- Readiness: `http://localhost:8080/readyz`

## Environment Notes

- `SELFHOST_API_RP_ID=localhost`
- `SELFHOST_API_RP_ORIGIN=http://localhost:8080`
- `SELFHOST_API_DATABASE_URL` already targets the Compose `db` service by default

If you change the exposed port or hostname, update `SELFHOST_API_RP_ORIGIN` before relying on WebAuthn flows.

## Smoke Test

1. Start the stack with `docker compose -f deploy/selfhost/docker-compose.yml up --build`.
2. Confirm `curl http://localhost:8080/readyz` returns `200`.
3. Open `http://localhost:8080` in one browser window and create a Quick Share channel.
4. Open the generated share link in a second window or incognito session and complete lock.
5. Confirm the sender manage page auto-updates to `locked` without a manual refresh.
6. Deliver a secret from the manage page.
7. Confirm the receiver share page auto-updates to `delivered` and shows the decrypt panel.

If WebSocket delivery is interrupted, the frontend will fall back to `/api/public/:uuid` polling automatically.

## Operational Notes

- This package serves the default frontend build. It does not enable the signed `Verified Release` bootstrap gate.
- The realtime hub is process-local. Running multiple API replicas behind the same proxy will require a shared pub/sub layer.
- Compose stores PostgreSQL data in the `postgres-data` volume.

## Stop The Stack

```bash
docker compose -f deploy/selfhost/docker-compose.yml down
```

To remove local database state too:

```bash
docker compose -f deploy/selfhost/docker-compose.yml down -v
```
