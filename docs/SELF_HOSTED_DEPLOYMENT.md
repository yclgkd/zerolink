> **Language**: English | [中文](./SELF_HOSTED_DEPLOYMENT.zh.md)

# Self-Hosted Deployment Guide

This guide packages the current ZeroLink frontend and Go self-hosted backend into a local Docker Compose stack.

## What This Stack Includes

- `web`: Caddy serving the built frontend and reverse-proxying `/api/*`
- `api`: Go self-hosted API
- `db`: PostgreSQL
- `minio`: S3-compatible object store for encrypted multipart file chunks
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

The bundled `.env.example` defaults to `SELFHOST_API_FILE_STORAGE_BACKEND=minio`, which enables
multipart file delivery up to `512 MiB` with `4 MiB` encrypted chunks.

Then open:

- App: `http://localhost:8080`
- Readiness: `http://localhost:8080/readyz`
- MinIO Console: `http://localhost:9001`

## Environment Notes

- `SELFHOST_API_RP_ID=localhost`
- `SELFHOST_API_RP_ORIGIN=http://localhost:8080`
- `SELFHOST_API_DATABASE_URL` already targets the Compose `db` service by default
- `SELFHOST_API_FILE_STORAGE_BACKEND=minio` enables multipart delivery through presigned MinIO PUT/GET URLs
- `SELFHOST_API_FILE_MAX_BYTES=536870912` sets the overall file ceiling, while `SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES=2080760` keeps the inline cutoff below the legacy inline envelope limit
- `SELFHOST_API_MINIO_*` already points at the bundled `minio` service and default `zerolink-files` bucket

If you change the exposed port or hostname, update `SELFHOST_API_RP_ORIGIN` before relying on WebAuthn flows.

If you want legacy inline-only behavior instead, set:

- `SELFHOST_API_FILE_STORAGE_BACKEND=inline`
- `SELFHOST_API_FILE_MULTIPART_SUPPORTED=false`
- `SELFHOST_API_FILE_MAX_BYTES` and `SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES` to values at or below `2080760`

The packaged Compose stack still starts MinIO by default; removing it requires customizing the
Compose file.

## Smoke Test

1. Start the stack with `docker compose -f deploy/selfhost/docker-compose.yml up --build`.
2. Confirm `curl http://localhost:8080/readyz` returns `200`.
3. Confirm `curl http://localhost:8080/api/file_policy` reports `multipartSupported: true` when running the default MinIO-backed stack.
4. Open `http://localhost:8080` in one browser window and create a Quick Share channel.
5. Open the generated share link in a second window or incognito session and complete lock.
6. Confirm the sender manage page auto-updates to `locked` without a manual refresh.
7. Deliver a secret from the manage page.
8. Confirm the receiver share page auto-updates to `delivered` and shows the decrypt panel.
9. Optional: deliver a file larger than `2 MiB` and confirm the receiver can still decrypt/download it; this exercises the MinIO multipart path instead of inline `cipherBundle` delivery.

If WebSocket delivery is interrupted, the frontend will fall back to `/api/public/:uuid` polling automatically.

## Operational Notes

- This package serves the default frontend build. It does not enable the signed `Verified Release` bootstrap gate.
- The realtime hub is process-local. Running multiple API replicas behind the same proxy will require a shared pub/sub layer.
- Compose stores PostgreSQL data in the `postgres-data` volume.
- Compose stores MinIO object data in the `minio-data` volume.
- Small files at or below `SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES` stay on the inline `cipherBundle` path; larger files use `/api/file/initiate`, direct MinIO presigned PUT/GET URLs, `/api/file/complete`, and `fileRef` metadata.
- The API server does not set a global HTTP write timeout so that WebSocket connections are not killed mid-session. Per-write deadlines are enforced inside the realtime hub. If you add a Caddy `timeouts` block, do not set `write_timeout` — it will terminate long-lived WebSocket sessions through the reverse proxy.

## Stop The Stack

```bash
docker compose -f deploy/selfhost/docker-compose.yml down
```

To remove local database state too:

```bash
docker compose -f deploy/selfhost/docker-compose.yml down -v
```
