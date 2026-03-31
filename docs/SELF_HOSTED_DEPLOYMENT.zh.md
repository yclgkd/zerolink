> **语言**: [English](./SELF_HOSTED_DEPLOYMENT.md) | 中文

# 自部署部署指南

这份文档说明如何用 Docker Compose 启动当前 ZeroLink 前端和 Go 自部署后端。

## 组件

- `web`: Caddy，负责静态前端和 `/api/*` 反向代理
- `api`: Go 自部署 API
- `db`: PostgreSQL
- `migrate`: 一次性迁移任务

## 实时同步行为

- `/api/ws/:uuid` 已在单实例 self-host 场景下实现
- 前端仍保留 `/api/public/:uuid` polling fallback
- 当前打包不包含 Redis 或共享 pub/sub，多实例扩容不在本次范围内

## 启动

```bash
cp deploy/selfhost/.env.example deploy/selfhost/.env
docker compose -f deploy/selfhost/docker-compose.yml up --build
```

访问：

- 应用：`http://localhost:8080`
- 就绪检查：`http://localhost:8080/readyz`

## 环境变量说明

- `SELFHOST_API_RP_ID=localhost`
- `SELFHOST_API_RP_ORIGIN=http://localhost:8080`
- 默认 `SELFHOST_API_DATABASE_URL` 已指向 Compose 里的 `db` 服务

如果你修改了端口或主机名，先同步更新 `SELFHOST_API_RP_ORIGIN`，再测试 WebAuthn。

## Smoke Test

1. 用 `docker compose -f deploy/selfhost/docker-compose.yml up --build` 启动。
2. 确认 `curl http://localhost:8080/readyz` 返回 `200`。
3. 在一个窗口打开 `http://localhost:8080`，创建一个 Quick Share channel。
4. 在第二个窗口或隐身窗口打开 share link，完成 lock。
5. 确认 sender 的 manage 页面无需手动刷新就切到 `locked`。
6. 在 manage 页面 deliver 一个 secret。
7. 确认 receiver 的 share 页面自动切到 `delivered`，并显示 decrypt panel。

如果 WebSocket 传输不可用，前端会自动退回 `/api/public/:uuid` 轮询。

## 运行说明

- 这个打包使用默认前端 build，不启用签名后的 `Verified Release` 启动校验。
- realtime hub 是进程内实现；如果要跑多个 API 副本，需要共享 pub/sub。
- PostgreSQL 数据存放在 `postgres-data` volume 中。

## 停止

```bash
docker compose -f deploy/selfhost/docker-compose.yml down
```

如果要一并删除本地数据库数据：

```bash
docker compose -f deploy/selfhost/docker-compose.yml down -v
```
