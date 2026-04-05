> **Language**: English | [中文](./SELF_HOSTED_DEPLOYMENT.zh.md)

# Self-Hosted Deployment Guide

This guide runs the published ZeroLink self-hosted stack from GitHub Container Registry (GHCR), with an opt-in local build override for developers who prefer compiling from source.

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

Choose a released ZeroLink version first so the downloaded Compose file and pulled images stay in sync:

```bash
export ZEROLINK_VERSION=YOUR_RELEASE_VERSION
mkdir zerolink-selfhost
cd zerolink-selfhost
curl -fsSLO "https://raw.githubusercontent.com/yclgkd/ZeroLink/v${ZEROLINK_VERSION}/deploy/selfhost/docker-compose.yml"
curl -fsSLo .env.example "https://raw.githubusercontent.com/yclgkd/ZeroLink/v${ZEROLINK_VERSION}/deploy/selfhost/.env.example"
cp .env.example .env
sed -i.bak "s/^ZEROLINK_IMAGE_TAG=.*/ZEROLINK_IMAGE_TAG=${ZEROLINK_VERSION}/" .env && rm .env.bak
docker compose up -d
```

The bundled `.env.example` defaults to `SELFHOST_API_FILE_STORAGE_BACKEND=minio`, which enables
multipart file delivery up to `512 MiB` with `4 MiB` encrypted chunks.

The default Compose file pulls these public images:

- `${ZEROLINK_IMAGE_REPOSITORY:-ghcr.io/yclgkd}/zerolink-api:${ZEROLINK_IMAGE_TAG:-latest}`
- `${ZEROLINK_IMAGE_REPOSITORY:-ghcr.io/yclgkd}/zerolink-web:${ZEROLINK_IMAGE_TAG:-latest}`

Set `ZEROLINK_IMAGE_TAG` in `.env` to pin a specific release instead of following `latest`, and set
`ZEROLINK_IMAGE_REPOSITORY` when consuming images published from a fork or org mirror.

## Local Build Override

If you want to build the images from the current source checkout instead of pulling GHCR artifacts:

```bash
git clone https://github.com/yclgkd/ZeroLink.git
cd ZeroLink/deploy/selfhost
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

`docker-compose.build.yml` restores the original local `build:` definitions for `migrate`, `api`,
and `web`, while keeping the default image-based stack unchanged for ordinary operators. The local
`web` override still rebuilds the frontend from source via `deploy/selfhost/frontend.build.Dockerfile`,
while published GHCR release images package the frontend `dist` produced earlier in CI via a
minimal self-host web build context.

Then open:

- App: `http://localhost:8080`
- Readiness: `http://localhost:8080/readyz`
- MinIO Console: `http://localhost:9001`

## Environment Notes

- `SELFHOST_API_RP_ID=localhost`
- `SELFHOST_API_RP_ORIGIN=http://localhost:8080`
- `ZEROLINK_IMAGE_REPOSITORY=ghcr.io/yclgkd` selects which GHCR namespace `migrate`, `api`, and `web` pull from
- `ZEROLINK_IMAGE_TAG=latest` selects the published image tag used by `migrate`, `api`, and `web`
- `SELFHOST_API_DATABASE_URL` already targets the Compose `db` service by default
- `SELFHOST_API_FILE_STORAGE_BACKEND=minio` enables multipart delivery through presigned MinIO PUT/GET URLs
- `SELFHOST_API_FILE_MAX_BYTES=536870912` sets the overall file ceiling, while `SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES=2080760` keeps the inline cutoff below the legacy inline envelope limit
- `SELFHOST_API_MINIO_*` already points at the bundled `minio` service and default `zerolink-files` bucket

If you change the exposed port or hostname, update `SELFHOST_API_RP_ORIGIN` before relying on WebAuthn flows.

## Storage Configuration

By default, the `docker-compose.yml` file runs a local **MinIO** container (`minio:9000`) and stores uploaded file chunks in the Docker volume `minio-data`.

### 1. Default Local MinIO
If you stick with the default local setup:
- **Default Credentials**: The bundled `.env.example` uses `minioadmin:minioadmin`. **Change these before exposing the service**.
- **Data Location**: Encrypted file parts reside in the `minio-data` volume on the host. Back up this volume along with `postgres-data` to preserve your state.
- **Admin Console**: The MinIO management console is exposed on port `9001` (`http://localhost:9001`) for debugging and bucket inspection.

### 2. External S3-Compatible Cloud Storage
You can bypass the local MinIO container and connect the ZeroLink API directly to any S3-compatible object storage (e.g., AWS S3, Cloudflare R2, Aliyun OSS, Tencent COS) without code changes.

Update the following variables in your `.env` file:
```env
SELFHOST_API_MINIO_ENDPOINT=s3.us-east-1.amazonaws.com  # Do NOT include https:// prefix
SELFHOST_API_MINIO_ACCESS_KEY=your_access_key
SELFHOST_API_MINIO_SECRET_KEY=your_secret_key
SELFHOST_API_MINIO_BUCKET=zerolink-files
SELFHOST_API_MINIO_USE_SSL=true  # Set to true for public cloud providers
SELFHOST_API_MINIO_REGION=us-east-1  # Set to 'auto' for Cloudflare R2
```
*Note: If you use external storage, you can safely remove the `minio` service and its associated volumes from your `docker-compose.yml` to save local resources.*

### 3. Extreme Lightweight "Inline" Mode
If you do not want to run an object storage server at all (e.g., on a Raspberry Pi) and only need to share small files, you can disable multipart storage entirely.

Set these variables in your `.env` to enable legacy inline-only behavior:
```env
SELFHOST_API_FILE_STORAGE_BACKEND=inline
SELFHOST_API_FILE_MULTIPART_SUPPORTED=false  # Defaults to false for inline; explicit here in case your .env inherits true from .env.example
SELFHOST_API_FILE_MAX_BYTES=2080760
SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES=2080760
```
When in `inline` mode:
- The system bypasses MinIO.
- Encrypted file data is stored as a JSON payload directly in the **PostgreSQL database** (JSONB column).
- **File size is strictly limited** to roughly `2 MiB`.

## Smoke Test

1. Start the stack with `docker compose up -d`.
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

- Production tag releases package the same CI-built frontend `dist` that passed manifest generate/sign/verify, so published `zerolink-web` images now include the signed `Verified Release` bootstrap gate by default.
- The local source-build override still uses the default frontend build path from `deploy/selfhost/frontend.build.Dockerfile`; it does not enable the signed bootstrap gate unless you explicitly reproduce the signed release build flow.
- Production tag releases publish the GHCR images with multi-arch `linux/amd64` + `linux/arm64` manifests and Buildx provenance/SBOM attestations, so operators can trace a pulled image back to the release commit and GitHub Actions run.
- The realtime hub is process-local. Running multiple API replicas behind the same proxy will require a shared pub/sub layer.
- Compose stores PostgreSQL data in the `postgres-data` volume.
- Compose stores MinIO object data in the `minio-data` volume.
- Small files at or below `SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES` stay on the inline `cipherBundle` path; larger files use `/api/file/initiate`, direct MinIO presigned PUT/GET URLs, `/api/file/complete`, and `fileRef` metadata.
- The API server does not set a global HTTP write timeout so that WebSocket connections are not killed mid-session. Per-write deadlines are enforced inside the realtime hub. If you add a Caddy `timeouts` block, do not set `write_timeout` — it will terminate long-lived WebSocket sessions through the reverse proxy.

## Stop The Stack

```bash
docker compose down
```

To remove local database state too:

```bash
docker compose down -v
```
