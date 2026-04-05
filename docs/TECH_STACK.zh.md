<!-- synced-with: 940a85a -->

> **语言**: [English](./TECH_STACK.md) | 中文

# ZeroLink 技术栈

## Monorepo

pnpm workspaces，包含三个包：`@zerolink/frontend`、`@zerolink/backend`、`@zerolink/shared`。

`shared` 是协议层——常量、Zod schemas、Canonical 序列化和密码学原语在前后端之间共享，防止协议分叉（例如 `intent_hash` 不一致）。

## 前端

| 技术 | 用途 |
|---|---|
| React 18 + TypeScript（strict） | UI 框架；strict 模式捕获密码学数据类型错误 |
| Vite | 构建工具与开发服务器 |
| Tailwind CSS v4 + shadcn/ui | 原子化 CSS + 基于 Radix 的组件原语 |
| Zustand | 轻量状态管理 |
| React Router v6 | 客户端路由 |
| Zod | 运行时 schema 验证；防御服务器返回非预期数据 |
| i18next | 双语支持（中文 / 英文） |
| MSW | Mock Service Worker，仅用于 UI 层测试，不用于协议逻辑测试 |

## 后端

| 技术 | 用途 |
|---|---|
| Cloudflare Workers | Serverless 运行时 |
| Durable Objects | 每个通道的串行化状态（version、nonce、lock、密文） |
| TypeScript（strict） | 协议边界的类型安全 |

## 密码学

| 库 | 用途 |
|---|---|
| Web Crypto API | AES-256-GCM 加密、RSA-OAEP 密钥封装、SHA-256 哈希 |
| `@noble/hashes` | Argon2id KDF，用于密码派生私钥包裹密钥 |
| `@noble/ed25519` | 浏览器端 Ed25519 Manifest 签名验证 |
| `@github/webauthn-json` | WebAuthn API 类型辅助 |

## 测试

| 工具 | 范围 |
|---|---|
| Vitest | 所有包的单元测试与集成测试 |
| Playwright | E2E 测试，包含 WebAuthn 模拟 |
| React Testing Library | 组件测试 |

协议逻辑测试（Canonical、lock_proof、intent_hash）必须对接真实后端运行，MSW 不能替代。

## 工具链

| 工具 | 用途 |
|---|---|
| Biome | Lint + 格式化（替代 ESLint + Prettier） |
| Husky + lint-staged | pre-commit：对 staged 文件执行 biome check + 全量 typecheck |
| GitHub Actions | CI（pr-validate.yml）与部署（deploy.yml、release.yml） |

## 部署

前端资产通过 `wrangler.toml` 的 `[assets]` 绑定随 Worker 一起部署，不使用 Cloudflare Pages。推送 `v*` tag 触发正式发布，合并到 `main` 自动部署 staging。

详见 [DEPLOYMENT.zh.md](./DEPLOYMENT.zh.md)（部署说明）和 [ARCHITECTURE.zh.md](./ARCHITECTURE.zh.md)（系统设计）。
