# Self-Hosted API (M1 Scaffold)

This module bootstraps the Go-based self-hosted backend for ZeroLink.

Current M1 scope:

- Go module and service layout under `services/selfhost-api/`
- Environment-based config loading with validation
- Structured JSON logging
- `GET /healthz` and `GET /readyz`
- PostgreSQL connection bootstrap
- Embedded SQL migration runner
- Reserved package boundaries for `httpapi`, `service`, `store`, `protocol`, `webauthn`, and `realtime`

Out of scope for M1:

- Protocol route implementations
- WebAuthn verification
- Realtime delivery
- Docker Compose / Caddy packaging

## Layout

```text
services/selfhost-api/
├── cmd/
│   ├── selfhost-api/        # HTTP server entrypoint
│   └── selfhost-migrate/    # Migration entrypoint
├── internal/
│   ├── app/                 # Runtime wiring
│   ├── config/              # Env loading + validation
│   ├── httpapi/             # Router, middleware, health handlers
│   ├── protocol/            # Frozen route surface for later milestones
│   ├── realtime/            # Realtime boundary placeholder
│   ├── service/             # Health/readiness service layer
│   ├── store/               # PostgreSQL + migration runner
│   └── webauthn/            # WebAuthn verification boundary placeholder
├── migrations/              # Embedded SQL migrations
└── README.md
```

## Configuration

Copy `.env.example` and set at least `SELFHOST_API_DATABASE_URL`.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SELFHOST_API_APP_ENV` | no | `development` | `development`, `test`, `production` |
| `SELFHOST_API_BIND_ADDR` | no | `:8788` | HTTP bind address |
| `SELFHOST_API_LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |
| `SELFHOST_API_DATABASE_URL` | yes | none | PostgreSQL DSN |
| `SELFHOST_API_DB_MAX_CONNS` | no | `8` | Pool upper bound |
| `SELFHOST_API_DB_MIN_CONNS` | no | `0` | Pool lower bound |
| `SELFHOST_API_DB_CONNECT_TIMEOUT` | no | `5s` | Initial connect timeout |
| `SELFHOST_API_DB_HEALTH_TIMEOUT` | no | `2s` | Readiness ping timeout |

## Local Development

### 1. Start PostgreSQL

Example with Docker:

```bash
docker run --name zerolink-selfhost-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=zerolink_selfhost \
  -p 5432:5432 \
  -d postgres:16
```

### 2. Run migrations

With a local Go toolchain:

```bash
cd services/selfhost-api
cp .env.example .env
go run ./cmd/selfhost-migrate
```

Without a local Go toolchain, run inside Docker:

```bash
export SELFHOST_API_DATABASE_URL='postgres://postgres:postgres@host.docker.internal:5432/zerolink_selfhost?sslmode=disable'

docker run --rm \
  -v "$PWD:/workspace" \
  -w /workspace/services/selfhost-api \
  -e SELFHOST_API_DATABASE_URL="$SELFHOST_API_DATABASE_URL" \
  golang:1.24 \
  go run ./cmd/selfhost-migrate
```

If PostgreSQL is running in another container instead of on the host, replace `host.docker.internal` with that container or Compose service name.

### 3. Start the API

With a local Go toolchain:

```bash
cd services/selfhost-api
go run ./cmd/selfhost-api
```

With Docker:

```bash
export SELFHOST_API_DATABASE_URL='postgres://postgres:postgres@host.docker.internal:5432/zerolink_selfhost?sslmode=disable'

docker run --rm \
  -v "$PWD:/workspace" \
  -w /workspace/services/selfhost-api \
  -p 8788:8788 \
  -e SELFHOST_API_BIND_ADDR=:8788 \
  -e SELFHOST_API_DATABASE_URL="$SELFHOST_API_DATABASE_URL" \
  golang:1.24 \
  go run ./cmd/selfhost-api
```

## Endpoints

- `GET /healthz`: process liveness only
- `GET /readyz`: readiness including PostgreSQL ping

All frozen protocol routes already exist as placeholders and currently return `501 NOT_IMPLEMENTED`. `GET /api/ws/:uuid` returns `426 BAD_REQUEST` when called without a websocket upgrade request.

## Validation

```bash
cd services/selfhost-api
go test ./...
go test -race ./...
```
