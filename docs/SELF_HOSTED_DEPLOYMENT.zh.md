> **语言**: [English](./SELF_HOSTED_DEPLOYMENT.md) | 中文

# 自部署部署指南

这份文档说明如何用 GitHub Container Registry (GHCR) 发布的镜像运行 ZeroLink 自部署栈，同时给开发者保留本地源码构建的 override。

## 组件

- `web`: Caddy，负责静态前端和 `/api/*` 反向代理
- `api`: Go 自部署 API
- `db`: PostgreSQL
- `garage` *（可选，通过 `--profile storage` 启用）*：S3 兼容对象存储，用于保存加密 multipart 文件分片
- `migrate`: 一次性迁移任务

## 实时同步行为

- `/api/ws/:uuid` 已在单实例 self-host 场景下实现
- 前端仍保留 `/api/public/:uuid` polling fallback
- 当前打包不包含 Redis 或共享 pub/sub，多实例扩容不在本次范围内

## 启动

请先选择一个已发布的 ZeroLink 版本，这样下载到的 Compose 文件与拉取的镜像可以保持同步：

```bash
export ZEROLINK_VERSION=YOUR_RELEASE_VERSION
mkdir zerolink-selfhost
cd zerolink-selfhost
curl -fsSLO "https://raw.githubusercontent.com/yclgkd/ZeroLink/v${ZEROLINK_VERSION}/deploy/selfhost/docker-compose.yml"
curl -fsSLO "https://raw.githubusercontent.com/yclgkd/ZeroLink/v${ZEROLINK_VERSION}/deploy/selfhost/garage.toml"
curl -fsSLO "https://raw.githubusercontent.com/yclgkd/ZeroLink/v${ZEROLINK_VERSION}/deploy/selfhost/garage-init.sh"
curl -fsSLo .env.example "https://raw.githubusercontent.com/yclgkd/ZeroLink/v${ZEROLINK_VERSION}/deploy/selfhost/.env.example"
cp .env.example .env
sed -i.bak "s/^ZEROLINK_IMAGE_TAG=.*/ZEROLINK_IMAGE_TAG=${ZEROLINK_VERSION}/" .env && rm .env.bak
docker compose --profile storage up -d
```

`.env.example` 默认使用 `SELFHOST_API_FILE_STORAGE_BACKEND=s3`，通过内置的 Garage 容器（由
`storage` profile 启动）开启 multipart 文件传输，默认总文件上限 `512 MiB`、分片大小 `4 MiB`。

默认 Compose 会拉取以下公开镜像：

- `${ZEROLINK_IMAGE_REPOSITORY:-ghcr.io/yclgkd}/zerolink-api:${ZEROLINK_IMAGE_TAG:-latest}`
- `${ZEROLINK_IMAGE_REPOSITORY:-ghcr.io/yclgkd}/zerolink-web:${ZEROLINK_IMAGE_TAG:-latest}`

如果你想固定到某个发布版本，而不是跟随 `latest`，请在 `.env` 中设置 `ZEROLINK_IMAGE_TAG`；
如果镜像来自 fork 或组织镜像仓库，请同时设置 `ZEROLINK_IMAGE_REPOSITORY`。

## 本地 build override

如果你希望直接从当前源码 checkout 构建镜像，而不是拉取 GHCR 制品：

```bash
git clone https://github.com/yclgkd/ZeroLink.git
cd ZeroLink/deploy/selfhost
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

`docker-compose.build.yml` 会把 `migrate`、`api` 和 `web` 恢复为本地 `build:` 路径，
而默认的镜像分发方式仍保持给普通运维用户使用。本地 `web` override 会通过
`deploy/selfhost/frontend.build.Dockerfile` 继续从源码重建前端，而发布到 GHCR 的镜像
则会通过最小化的 self-host web build context 打包 CI 里已经生成好的前端 `dist`。

访问：

- 应用：`http://localhost:8080`
- 就绪检查：`http://localhost:8080/readyz`

## 环境变量说明

- `SELFHOST_API_RP_ID=localhost`
- `SELFHOST_API_RP_ORIGIN=http://localhost:8080`
- `ZEROLINK_IMAGE_REPOSITORY=ghcr.io/yclgkd` 控制 `migrate`、`api`、`web` 默认从哪个 GHCR namespace 拉取镜像
- `ZEROLINK_IMAGE_TAG=latest` 控制 `migrate`、`api`、`web` 默认拉取的发布镜像 tag
- 默认 `SELFHOST_API_DATABASE_URL` 已指向 Compose 里的 `db` 服务
- `SELFHOST_API_FILE_STORAGE_BACKEND=s3` 启用 multipart 文件传输；当 `SELFHOST_API_S3_PUBLIC_ENDPOINT` 已设置时浏览器通过 S3 预签名 URL 直传，未设置时 API 代理 chunk 字节
- `SELFHOST_API_FILE_MAX_BYTES=536870912` 是总文件上限；`SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES=2080760` 把 inline 分界线限制在旧的 inline envelope 上限之内
- `SELFHOST_API_S3_*` 配置 S3 兼容存储连接；使用内置 Garage 容器时，已默认指向 `garage:3900` 和 `zerolink-files` bucket

如果你修改了端口或主机名，先同步更新 `SELFHOST_API_RP_ORIGIN`，再测试 WebAuthn。

## 存储配置

自部署栈支持三种存储模式：

- **`s3` + 内置 Garage**（默认）：`.env.example` 默认使用此模式，配合 `docker compose --profile storage up -d` 启动。
- **`s3` + 外部提供商**：配置 `SELFHOST_API_S3_*` 指向 AWS S3、Cloudflare R2、阿里云 OSS 等。运行 `docker compose up -d`（不带 `storage` profile）。
- **`inline`**：纯文本模式，无需对象存储；新的文件上传不可用。

### 1. 默认本地 Garage
上面的快速开始命令已自动启动 Garage。如果你已经在使用默认配置：

```bash
docker compose --profile storage up -d
```

- **凭证**：参见 `.env.example` 中的 Garage access key 和 secret key。**在将服务暴露到公网前务必修改**。
- **数据位置**：加密后的文件分片存储在宿主机的 `garage-data` volume 中。如需备份或迁移，请将它与 `postgres-data` 一同打包。
- Garage 是可选的。如果你使用外部 S3 提供商，只需运行 `docker compose up -d`（不带 `storage` profile）。

### 2. 接入外部 S3 兼容云存储
你可以完全跳过 Garage 容器，让 ZeroLink API 直接连向任何 S3 兼容的公有云对象存储（如阿里云 OSS、腾讯云 COS、AWS S3、Cloudflare R2），无需任何代码修改。

在 `.env` 中设置 `SELFHOST_API_FILE_STORAGE_BACKEND=s3`，然后更新以下变量：
```env
SELFHOST_API_S3_ENDPOINT=oss-cn-hangzhou.aliyuncs.com
SELFHOST_API_S3_ACCESS_KEY=你的_access_key
SELFHOST_API_S3_SECRET_KEY=你的_secret_key
SELFHOST_API_S3_BUCKET=zerolink-files
SELFHOST_API_S3_USE_SSL=true
SELFHOST_API_S3_REGION=cn-hangzhou
```
*提示：使用外部存储时，直接运行 `docker compose up -d`（不带 `--profile storage`），Garage 容器不会启动，节省本地资源。*

### 3. 极简 "Inline" 模式（纯文本）
如果你只是想在个人的树莓派或极低配置 NAS 上跑着玩，完全不想启动任何对象存储服务，可以彻底关闭 multipart 机制。这样仍可分享文本，但新的文件上传会被拒绝。

在 `.env` 中设置以下变量以启用纯文本 inline 模式：
```env
SELFHOST_API_FILE_STORAGE_BACKEND=inline
SELFHOST_API_FILE_MULTIPART_SUPPORTED=false  # backend=inline 时默认即为 false；若你的 .env 从 .env.example 复制而来则需显式覆盖
SELFHOST_API_FILE_MAX_BYTES=2080760
SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES=2080760
```
在 `inline` 模式下：
- 无需任何对象存储。
- `multipartSupported` 会保持为 `false`，因此新的文件上传会以 `FILE_STORAGE_UNAVAILABLE` 被拒绝。
- 文本载荷仍继续使用 inline `cipherBundle`，并保存在 PostgreSQL-backed channel state 中。

## Smoke Test

1. 用 `docker compose up -d` 启动。
2. 确认 `curl http://localhost:8080/readyz` 返回 `200`。
3. 确认 `curl http://localhost:8080/api/file_policy` 在 `SELFHOST_API_FILE_STORAGE_BACKEND=s3` 时返回 `multipartSupported: true`。
4. 在一个窗口打开 `http://localhost:8080`，创建一个 Quick Share channel。
5. 在第二个窗口或隐身窗口打开 share link，完成 lock。
6. 确认 sender 的 manage 页面无需手动刷新就切到 `locked`。
7. 在 manage 页面 deliver 一个 secret。
8. 确认 receiver 的 share 页面自动切到 `delivered`，并显示 decrypt panel。
9. 可选：投递一个文件，并确认接收端仍能解密/下载；如果文件大于当前配置的 chunk 大小（默认 `4 MiB`），还能顺便覆盖 multi-chunk 上传/下载路径。

如果 WebSocket 传输不可用，前端会自动退回 `/api/public/:uuid` 轮询。

## 运行说明

- production tag 发布时，`zerolink-web` 会直接打包同一份已通过 manifest generate/sign/verify 的 CI 前端 `dist`，因此默认包含签名 `Verified Release` 启动门禁。
- 本地源码 build override 仍使用 `deploy/selfhost/frontend.build.Dockerfile` 走默认前端构建路径；除非你显式复现签名 release build 流程，否则不会启用该门禁。
- production tag 发布时，GHCR 镜像会附带 `linux/amd64` + `linux/arm64` 多架构 manifest，以及 Buildx 生成的 provenance / SBOM attestation，便于把拉取到的镜像追溯回具体 release commit 和 GitHub Actions run。
- realtime hub 是进程内实现；如果要跑多个 API 副本，需要共享 pub/sub。
- PostgreSQL 数据存放在 `postgres-data` volume 中。
- 使用 `storage` profile 时，Garage 对象数据存放在 `garage-data` volume 中。
- 所有新的 `payloadKind=file` 交付都通过 `/api/file/initiate`、`/api/file/complete` 和 `fileRef` 元数据走对象存储。当 `S3_PUBLIC_ENDPOINT` 已设置时 chunk 字节走 S3 预签名 URL 直传；未设置（如 Docker 内置 Garage）时通过 API 代理。只有文本载荷走 inline `cipherBundle`。
- API 服务没有设置全局 HTTP write timeout，以避免 WebSocket 长连接被断开；per-write 超时由 realtime hub 内部保证。如果你在 Caddy 配置中添加 `timeouts` 块，**不要**设置 `write_timeout`，否则反向代理会中断 WebSocket 会话。

## 停止

```bash
docker compose down
```

如果要一并删除本地数据库数据：

```bash
docker compose down -v
```
