# ZeroLink 部署指南 / Deployment Guide

> 本文档涵盖将 ZeroLink 部署到 Cloudflare 的完整步骤。
> This document covers the complete steps to deploy ZeroLink to Cloudflare.

---

## 目录 / Table of Contents

1. [前提条件 / Prerequisites](#前提条件--prerequisites)
2. [架构概览 / Architecture Overview](#架构概览--architecture-overview)
3. [快速部署 / Quick Deploy](#快速部署--quick-deploy)
4. [手动部署：后端 Worker](#手动部署后端-worker)
5. [手动部署：前端 Pages](#手动部署前端-pages)
6. [环境变量参考 / Environment Variables](#环境变量参考--environment-variables)
7. [Manifest 签名（可选）/ Manifest Signing](#manifest-签名可选--manifest-signing)
8. [自定义域名 / Custom Domain](#自定义域名--custom-domain)
9. [CI/CD 自动部署 / Automated Deployment](#cicd-自动部署--automated-deployment)
10. [故障排查 / Troubleshooting](#故障排查--troubleshooting)

---

## 前提条件 / Prerequisites

| 要求 | 说明 | 最低版本 |
|------|------|---------|
| Cloudflare 账号 | 免费版即可（支持 Durable Objects 免费层） | — |
| Node.js | JavaScript 运行时 | 22.x |
| pnpm | 包管理器 | 9.x |
| Wrangler CLI | Cloudflare 官方部署工具 | 3.x |

> **重要 / Important**: Durable Objects 自 2026 年起提供 **免费层 (Free Tier)**。
> 本项目已适配 **SQLite 存储后端**，支持在免费计划下运行（每日 10 万次请求限额）。
> Durable Objects now offer a **Free Tier**. This project uses the **SQLite backend**, which is supported on the free plan (100k daily requests).

安装 Wrangler CLI / Install Wrangler CLI:
```bash
npm install -g wrangler
```

---

## 架构概览 / Architecture Overview

```
用户浏览器                Cloudflare 边缘
───────────            ──────────────────────────────────────
Frontend SPA    ──→    Pages (CDN 静态托管)
      │                        │
      └──── API 请求 ──────→   Worker (zerolink-api)
                                    │
                            ┌───────┴───────┐
                            │               │
                       Durable Object   KV Namespace
                       (SecretVault)   (SECRETS_KV)
                       [状态机/SQLite]  [键值存储]
```

- **Cloudflare Pages**：托管编译后的 React SPA（全球 CDN）
- **Cloudflare Worker**：处理 API 请求（边缘计算）
- **Durable Object**：每个 Secret 的原子状态机（SQLite 后端）
- **KV Namespace**：辅助键值存储

---

## 快速部署 / Quick Deploy

### 一键部署后端 Worker

点击下方按钮，将 ZeroLink Worker 部署到你的 Cloudflare 账号：

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-F4801A?style=for-the-badge&logo=cloudflare&logoColor=white)](https://deploy.cloudflare.com/?url=https://github.com/yclgkd/ZeroLink)

> **注意 / Note**: 一键部署完成后，仍需手动完成以下步骤：
> After one-click deploy, you still need to manually:
> 1. 创建 KV namespace 并更新绑定 / Create KV namespace and update binding
> 2. 设置 `RP_ID` 和 `RP_ORIGIN` 环境变量 / Set `RP_ID` and `RP_ORIGIN` env vars
> 3. 单独部署前端到 Cloudflare Pages / Deploy frontend separately to Cloudflare Pages

---

## 手动部署：后端 Worker

### 第 1 步：登录 Wrangler

```bash
npx wrangler login
```

### 第 2 步：创建 KV Namespace

```bash
# 创建生产环境 KV namespace
npx wrangler kv:namespace create SECRETS_KV

# 命令输出示例：
# ✅ Successfully created namespace "SECRETS_KV"
# Add the following to your wrangler.toml:
# [[kv_namespaces]]
# binding = "SECRETS_KV"
# id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

记录返回的 `id` 值，更新 `packages/backend/wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "SECRETS_KV"
id = "你的-kv-namespace-id"  # ← 替换为实际 ID
```

### 第 3 步：确认 wrangler.toml 配置

`packages/backend/wrangler.toml` 配置参考：

```toml
name = "zerolink-api"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[durable_objects.bindings]]
name = "SECRET_VAULT"
class_name = "SecretVault"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["SecretVault"]

[[kv_namespaces]]
binding = "SECRETS_KV"
id = "你的-kv-namespace-id"
```

### 第 4 步：部署 Worker

```bash
cd packages/backend

# 替换为你的实际域名
RP_ID="your-domain.example.com"
RP_ORIGIN="https://your-domain.example.com"

npx wrangler deploy \
  --var RP_ID:"${RP_ID}" \
  --var RP_ORIGIN:"${RP_ORIGIN}"
```

> **WebAuthn 说明 / WebAuthn Note**:
> - `RP_ID` = 你的域名（不含协议前缀），例如 `zerolink.example.com`
> - `RP_ORIGIN` = 完整的 Origin，例如 `https://zerolink.example.com`
> - 如果使用 `*.workers.dev`，则 `RP_ID=your-worker.username.workers.dev`
> - 这两个值必须与实际访问域名完全匹配，否则 WebAuthn 认证会失败

### 第 5 步：验证部署

```bash
# 查看 Worker 日志
npx wrangler tail

# 测试 API 健康检查
curl https://your-worker.username.workers.dev/api/health
```

---

## 手动部署：前端 Pages

### 选项 A：Cloudflare Pages（推荐）

#### 构建前端

```bash
cd packages/frontend
pnpm build
# 构建输出在 dist/ 目录
```

默认的 `pnpm build` 产物是可运行但**未验证**的前端壳。它不会启用 fail-closed 的
`Verified Release` 启动门禁，因此适用于本地预览、普通静态托管和未签名的手动部署。

#### 创建并部署 Pages 项目

```bash
# 首次创建项目
npx wrangler pages project create zerolink-frontend

# 部署到 Pages
npx wrangler pages deploy dist \
  --project-name zerolink-frontend \
  --branch main
```

如果你需要和官方发布一致的 `Verified Release` 行为，使用仓库内的
`.github/workflows/deploy.yml`。该工作流会在构建时注入
`VITE_RELEASE_VERIFICATION_REQUIRED=true`，然后生成、签名并校验 `manifest.json` /
`manifest.sig` 后再上传到 Pages。

#### 配置 API 代理

前端需要通过 `_redirects` 文件将 `/api/*` 代理到 Worker。

在 `packages/frontend/public/_redirects` 中添加：

```
/api/* https://zerolink-api.username.workers.dev/:splat 200
```

或使用 Pages Functions（`packages/frontend/functions/api/[[path]].ts`）进行代理。

### 选项 B：手动上传 dist

```bash
cd packages/frontend
pnpm build

# 将 dist/ 目录内容上传到任意静态托管服务
# 例如通过 Cloudflare Dashboard 上传
```

这种手工上传方式默认也是“可运行但未验证”的模式。若未显式启用
`VITE_RELEASE_VERIFICATION_REQUIRED=true` 并同时上传签名产物，前端不会进入
`Verified Release` 模式。

---

## 环境变量参考 / Environment Variables

### Worker 运行时变量（通过 `--var` 传入）

| 变量名 | 必须 | 说明 | 示例 |
|--------|------|------|------|
| `RP_ID` | ✅ | WebAuthn Relying Party ID（域名，不含协议） | `zerolink.example.com` |
| `RP_ORIGIN` | ✅ | WebAuthn Origin（完整 URL） | `https://zerolink.example.com` |

### CI/CD Secrets（GitHub Actions）

| Secret 名 | 说明 |
|-----------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需有 Worker + Pages + KV 权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `CF_RP_ID` | 生产环境 RP_ID |
| `CF_RP_ORIGIN` | 生产环境 RP_ORIGIN |
| `MANIFEST_SIGNING_KEY` | Ed25519 私钥（base64）用于 manifest 签名 |

### 创建 Cloudflare API Token

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **My Profile → API Tokens → Create Token**
3. 选择 **Edit Cloudflare Workers** 模板
4. 额外添加权限：
   - `Cloudflare Pages:Edit`
   - `Workers KV Storage:Edit`
5. 复制 Token 并保存到 GitHub Secrets

---

## Manifest 签名（可选）/ Manifest Signing

ZeroLink 支持对前端构建产物进行 Ed25519 签名，供用户验证完整性。只有显式启用了
`VITE_RELEASE_VERIFICATION_REQUIRED=true` 且同时发布签名产物的构建，才会在浏览器端
启用 fail-closed 的 `Verified Release` 启动校验。

### 生成密钥对

```bash
# 使用 OpenSSL 生成 Ed25519 密钥
openssl genpkey -algorithm ed25519 -out keys/manifest-signing.pem
openssl pkey -in keys/manifest-signing.pem -pubout -out keys/manifest-signing.pub

# GitHub Secret MANIFEST_SIGNING_KEY 直接保存 PEM 文本内容
cat keys/manifest-signing.pem
```

> 私钥（`.pem`）已在 `.gitignore` 中排除，**切勿提交到 git**。

### 本地签名流程

```bash
# 构建
VITE_RELEASE_VERIFICATION_REQUIRED=true pnpm build

# 生成 manifest（记录 `entryAssetPath`，并仅哈希 `dist/assets/` 下的稳定运行时资源；根目录文档如 `index.html`、`robots.txt` 以及 `_headers`、`_redirects` 不进入签名集）
pnpm manifest:generate

# 签名 manifest
MANIFEST_SIGNING_KEY="$(cat keys/manifest-signing.pem)" \
  pnpm manifest:sign

# 验证签名
pnpm manifest:verify
```

Cloudflare Pages 的缓存策略应保持为：SPA 入口请求 `Cache-Control: no-store`，哈希
后的 `/assets/*` 继续使用长期 immutable 缓存。仓库内的 `packages/frontend/public/_headers`
已按该策略配置。这样可以避免浏览器或边缘层复用旧的 HTML 壳；同时签名 manifest 现在只
覆盖 `dist/assets/` 下的稳定运行时产物，不再覆盖 `index.html`、`robots.txt` 等根目录
文档，因为 Cloudflare 等平台可能为这些响应追加请求相关内容，导致字节级哈希不稳定。
作为补偿，生成出来的 `manifest.json` 会记录当前应执行的入口 bundle (`entryAssetPath`)，
浏览器端 bootstrap 会先确认自己正在运行的入口资源与 manifest 一致；若不一致，会先
触发一次受控刷新，仍无法恢复时再 fail-closed 阻断。

---

## 自定义域名 / Custom Domain

### Worker 自定义域名

1. 在 Cloudflare Dashboard → Workers → `zerolink-api` → Settings → Domains & Routes
2. 添加自定义域名（例如 `api.zerolink.example.com`）
3. 或在 `wrangler.toml` 中添加 routes：

```toml
routes = [
  { pattern = "api.zerolink.example.com/*", zone_name = "example.com" }
]
```

### Pages 自定义域名

1. Cloudflare Dashboard → Pages → `zerolink-frontend` → Custom domains
2. 添加你的域名，按提示配置 DNS
3. 更新前端的 API 代理目标为新的 Worker 域名

---

## CI/CD 自动部署 / Automated Deployment

项目包含一个独立的部署工作流 `.github/workflows/deploy.yml`，支持：
- 手动触发（选择环境）
- Tag 推送自动触发

### 配置步骤

1. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加所有必要 Secrets
2. 推送 `v*` tag 触发自动部署：

```bash
git tag v1.0.0
git push origin v1.0.0
```

3. 或在 GitHub Actions 页面手动触发 **Deploy** 工作流

---

## 故障排查 / Troubleshooting

### WebAuthn 认证失败

**症状**: 无法创建或验证 passkey

**解决方案**:
- 确认 `RP_ID` 与访问域名完全匹配（不含 `https://`）
- 确认 `RP_ORIGIN` 与浏览器访问的 Origin 完全匹配（含 `https://`）
- WebAuthn 不支持 `localhost` 以外的非 HTTPS 域名

### Durable Object 迁移失败

**症状**: Worker 返回 500 错误，日志显示 DO 相关错误

**解决方案**:
```bash
# 查看实时日志
npx wrangler tail zerolink-api

# 确认 wrangler.toml 中的 migrations 配置正确
cat packages/backend/wrangler.toml
```

### KV 读写失败

**症状**: API 返回 KV 相关错误

**解决方案**:
- 确认 `wrangler.toml` 中的 KV namespace ID 是当前账号的 ID
- 确认 API Token 有 KV 读写权限
- 使用 `npx wrangler kv:namespace list` 查看当前账号的所有 namespace

### 构建失败

```bash
# 清理缓存重新构建
pnpm clean  # 如有配置
rm -rf packages/*/dist
pnpm install --frozen-lockfile
pnpm build
```

### 前端无法连接后端

**症状**: API 请求 404 或 CORS 错误

**解决方案**:
- 检查 `packages/frontend/public/_redirects` 中的代理配置
- 确认 Worker URL 正确
- 在浏览器开发者工具 Network 面板检查实际请求 URL

---

## 相关文档 / Related Docs

- [快速启动指南](./QUICK_START.md) - 本地开发环境配置
- [技术栈规范](./TECH_STACK.md) - 完整技术栈说明
- [架构概览](./ARCHITECTURE.md) - 系统设计
- [安全模型](./SECURITY.md) - 威胁模型与安全保证

---

**最后更新 / Last Updated**: 2026-03-02
