<!-- synced-with: 940a85a -->

> **语言**: [English](./README.md) | 中文

# ZeroLink

> 零知识秘密分享工具：无账号、端到端加密、发送方管理但不可解密

## 概述

ZeroLink 是一款安全优先的秘密分享工具，具有以下特点：

- **零知识架构**：服务器不存明文与任何私钥
- **端到端加密**：只有接收方可解密内容
- **双模式创建**：Quick Share（密码）/ Secure Share（Passkey）
- **WebAuthn 管理**：Secure Share 使用系统/硬件密钥管理权（不可导出）
- **TOFU 防护**：URL Fragment + Lock Challenge 防止抢占锁定
- **密文长度保护**：Padding 降低长度泄露精度
- **当前产品模式**：Quick Share / Secure Share，legacy 档位仅保留向后兼容

## 核心流程

```
1. Sender → Create (Quick Share 密码模式 / Secure Share Passkey 模式)
          → 分享链接: /s/:uuid#k=<lock_secret>

2. Receiver → Lock (输入密码 → 生成 RSA keypair → 本地存储)
            → 展示 Safety Code (Emoji/Color)

3. Sender → 核对 Safety Code (带外)
          → Deliver (混合加密 + Padding → 投递密文)

4. Receiver → 输入密码 → 解密查看
```

## 文档

### 快速开始
- [快速启动指南](./docs/QUICK_START.zh.md) - 从零到运行开发环境
- [部署指南](./docs/DEPLOYMENT.zh.md) - 部署到 Cloudflare（含一键部署）
- [技术栈规范](./docs/TECH_STACK.zh.md) - 完整技术栈与工具链

### 设计文档
- [完整 PRD v3.0](./docs/PRD.zh.md) - 产品需求文档
- [架构概览](./docs/ARCHITECTURE.zh.md) - 技术架构与核心协议
- [安全模型](./docs/SECURITY.zh.md) - 威胁模型与安全保证

### 导航
- [文档索引](./docs/INDEX.zh.md) - AI 助手和开发者的快速导航

## 技术栈

### 前端
- React 19 + Vite 7 + React Router
- Tailwind CSS v4 + shadcn/ui（基于 Radix primitives）
- Zustand + Zod
- Web Crypto API (AES-GCM, RSA-OAEP, SHA-256)
- WebAuthn (FIDO2)
- Argon2id (KDF)

### 后端
- Cloudflare Workers + Durable Objects（提供免费层，支持 SQLite 后端）+ KV
- 可选：Docker Compose 自托管（计划中，尚未实现）

## 浏览器兼容性

| 浏览器 | 最低版本 | 发布时间 |
|--------|----------|----------|
| Chrome / Edge | 93+ | 2021 年 9 月 |
| Firefox | 92+ | 2021 年 9 月 |
| Safari | 15.4+ | 2022 年 3 月 |

**说明**：
- WebAuthn（硬件密钥）需要 HTTPS，本地开发使用 `localhost` 即可
- Ed25519 签名验证：Chrome 113+ / Safari 16.4+ 使用原生 WebCrypto；旧版本自动降级到纯 JS 实现（`@noble/ed25519`）
- 不提供 polyfill，不支持 Internet Explorer

## 安全特性

### v3.0 当前重点

1. **Lock Secret (URL Fragment)**: 防止预加载爬虫抢占锁定
2. **Padding (4KB 块)**: 降低密文长度泄露精度
3. **Argon2id 强制**: 接收方私钥包裹（250-500ms 目标耗时）
4. **双模式创建**: Quick Share（密码）/ Secure Share（Passkey）
5. **可验证发布链**: Signed Manifest + 可复现构建（未来）

### 安全保证

- ✅ 服务器零知识
- ✅ 端到端保密
- ✅ 更新/销毁不可伪造（WebAuthn）
- ✅ 抗重放/乱序/并发覆盖（DO 原子性）
- ✅ 最小元数据泄露
- ✅ 前端完整性可验证（CSP/SRI）
- ✅ Secure Share 管理权私钥不可导出（WebAuthn）；Quick Share 管理密钥编码在管理链接中

## 部署 / Deploy

### 一键部署到 Cloudflare / One-click Deploy

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-F4801A?style=for-the-badge&logo=cloudflare&logoColor=white)](https://deploy.cloudflare.com/?url=https://github.com/yclgkd/ZeroLink)

> **注意**: 一键部署后，运行 `pnpm setup` 完成 KV namespace 创建和 Secrets 配置（只需回答 2 个问题）。
>
> **Note**: After one-click deploy, run `pnpm setup` to finish KV namespace creation and secrets configuration (only 2 questions required).

### 前提条件 / Prerequisites

- Cloudflare 账号（免费计划即可，支持 Durable Objects 免费层）
- Node.js 22+ · pnpm 9+ · Wrangler CLI 3+

完整部署文档见 [部署指南](./docs/DEPLOYMENT.zh.md)

---

## 快速开始（本地开发）/ Quick Start (Local Dev)

```bash
git clone https://github.com/yclgkd/ZeroLink.git
cd ZeroLink
pnpm install
pnpm dev
```

## License

（待补充）
