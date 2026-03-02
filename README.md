# ZeroLink

> 零知识秘密分享工具：无账号、端到端加密、发送方管理但不可解密

## 概述

ZeroLink 是一款安全优先的秘密分享工具，具有以下特点：

- **零知识架构**：服务器不存明文与任何私钥
- **端到端加密**：只有接收方可解密内容
- **WebAuthn 管理**：发送方管理权基于系统/硬件密钥（不可导出）
- **TOFU 防护**：URL Fragment + Lock Challenge 防止抢占锁定
- **密文长度保护**：Padding 降低长度泄露精度
- **三档安全模式**：Standard / Strict / Hardware-Only

## 核心流程

```
1. Sender → Create (WebAuthn 注册)
          → 分享链接: /s/:uuid#k=<lock_secret>

2. Receiver → Lock (输入密码 → 生成 RSA keypair → 本地存储)
            → 展示 Safety Code (Emoji/Color)

3. Sender → 核对 Safety Code (带外)
          → Deliver (混合加密 + Padding → 投递密文)

4. Receiver → 输入密码 → 解密查看
```

## 文档

### 快速开始
- [快速启动指南](./docs/QUICK_START.md) - 从零到运行开发环境
- [部署指南](./docs/DEPLOYMENT.md) - 部署到 Cloudflare（含一键部署）
- [技术栈规范](./docs/TECH_STACK.md) - 完整技术栈与工具链

### 设计文档
- [完整 PRD v2.5](./docs/PRD-v2.5.md) - 产品需求文档
- [架构概览](./docs/ARCHITECTURE.md) - 技术架构与核心协议
- [安全模型](./docs/SECURITY.md) - 威胁模型与安全保证

### 导航
- [文档索引](./docs/INDEX.md) - AI 助手和开发者的快速导航

## 技术栈

### 前端
- React 19 + Vite 7 + React Router
- Tailwind CSS v4 + shadcn/ui（基于 Radix primitives）
- Zustand + Zod
- Web Crypto API (AES-GCM, RSA-OAEP, SHA-256)
- WebAuthn (FIDO2)
- Argon2id (KDF)

### 后端
- Cloudflare Workers + Durable Objects + KV（提供免费层，支持 SQLite 后端）
- 可选：Docker Compose 自托管

## 安全特性

### v2.5 核心改进

1. **Lock Secret (URL Fragment)**: 防止预加载爬虫抢占锁定
2. **Padding (4KB 块)**: 降低密文长度泄露精度
3. **Argon2id 强制**: 接收方私钥包裹（250-500ms 目标耗时）
4. **三档安全模式**: Standard / Strict / Hardware-Only
5. **可验证发布链**: Signed Manifest + 可复现构建（未来）

### 安全保证

- ✅ 服务器零知识
- ✅ 端到端保密
- ✅ 更新/销毁不可伪造（WebAuthn）
- ✅ 抗重放/乱序/并发覆盖（DO 原子性）
- ✅ 最小元数据泄露
- ✅ 前端完整性可验证（CSP/SRI）
- ✅ 管理权私钥不可导出

## 部署 / Deploy

### 一键部署到 Cloudflare / One-click Deploy

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-F4801A?style=for-the-badge&logo=cloudflare&logoColor=white)](https://deploy.cloudflare.com/?url=https://github.com/yclgkd/ZeroLink)

> **注意**: 一键部署仅部署后端 Worker。部署完成后需手动创建 KV namespace、设置 `RP_ID`/`RP_ORIGIN` 环境变量，并单独部署前端。
>
> **Note**: One-click deploy only deploys the backend Worker. After deployment, you need to manually create the KV namespace, set `RP_ID`/`RP_ORIGIN` env vars, and deploy the frontend separately.

### 使用自动化脚本 / Automated Setup

```bash
git clone https://github.com/yclgkd/ZeroLink.git
cd ZeroLink
chmod +x scripts/setup-cloudflare.sh
./scripts/setup-cloudflare.sh
```

### 前提条件 / Prerequisites
### 前提要求

- Cloudflare 账号（免费计划即可，支持 Durable Objects 免费层）
- Node.js 20+ · pnpm 9+ · Wrangler CLI 3+

完整部署文档见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
---

## 快速开始（本地开发）/ Quick Start (Local Dev)

```bash
# 1. 克隆仓库
git clone https://github.com/yclgkd/ZeroLink.git
cd ZeroLink

# 2. 运行初始化脚本
chmod +x scripts/init-monorepo.sh
./scripts/init-monorepo.sh

# 3. 开始开发
pnpm dev
```

详细步骤见 [快速启动指南](./docs/QUICK_START.md)

## License

（待补充）
