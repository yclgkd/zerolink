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
- Cloudflare Workers + Durable Objects + KV
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

## 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/your-org/ZeroLink.git
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
