# ZeroLink 技术栈规范

> **版本**: v1.1
> **最后更新**: 2026-03-10
> **状态**: 已落地，与 main 分支保持同步

---

## 目录

- [总览](#总览)
- [核心技术栈](#核心技术栈)
- [Monorepo 结构](#monorepo-结构)
- [密码学与安全](#密码学与安全)
- [开发工作流](#开发工作流)
- [质量闸门](#质量闸门)
- [部署与发布](#部署与发布)
- [配置文件清单](#配置文件清单)

---

## 总览

### 设计原则

1. **安全优先**: 类型安全 + 运行时验证双重保护
2. **协议一致性**: 前后端共享关键代码（Canonical、常量、Schema）
3. **快速反馈**: Vite 快速开发 + Vitest 快速测试
4. **代码质量**: Biome 统一规范 + TypeScript strict + 自动化检查
5. **可维护性**: Monorepo + GitHub Actions 发布流程

### 技术选型理由（ZeroLink 特定）

| 技术 | 选择理由 | ZeroLink 相关 |
|------|---------|--------------|
| **Monorepo** | 协议级一致性要求（Canonical、常量、Schema 必须共享） | 避免前后端 intent_hash 不匹配等灾难性 bug |
| **TypeScript strict** | 防止密码学数据类型错误（Buffer vs string 等） | 加密操作的类型安全至关重要 |
| **Zod** | 运行时验证 + 类型推导 | 防御恶意服务器返回非预期数据 |
| **Biome** | 统一代码风格 + 快速（比 ESLint+Prettier 快 10-100x） | 大量密码学代码需要严格格式 |
| **Vitest** | 与 Vite 无缝集成 + 快速 | 测试 Canonical 等协议逻辑需要快速反馈 |
| **Playwright** | WebAuthn API 模拟 + 跨浏览器 | 测试完整的 Create→Lock→Deliver 流程 |

---

## 核心技术栈

### 语言与框架

#### React 19 + TypeScript

```json
{
  "dependencies": {
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "typescript": "^5.9.3"
  }
}
```

**配置要求**:
- TypeScript **strict mode**（必须）
- `tsconfig.json` 必须包含:
  ```json
  {
    "compilerOptions": {
      "strict": true,
      "noUncheckedIndexedAccess": true,  // 防止数组越界
      "noImplicitOverride": true,
      "noPropertyAccessFromIndexSignature": true
    }
  }
  ```

#### Vite

```json
{
  "devDependencies": {
    "vite": "^7.3.1",
    "@vitejs/plugin-react": "^5.1.4"
  }
}
```

#### Tailwind CSS v4 + shadcn/ui

```json
{
  "dependencies": {
    "tailwindcss": "^4.2.1",
    "@tailwindcss/vite": "^4.2.1",
    "@radix-ui/react-slot": "^1.2.4",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.5.0"
  }
}
```

**安全配置要求**（见后文"安全相关配置"）

---

### 代码规范与质量闸门

#### Biome（替代 ESLint + Prettier）

```json
{
  "devDependencies": {
    "@biomejs/biome": "^2.4.4"
  }
}
```

**职责**:
- ✅ Format（代码格式化）
- ✅ Lint（代码检查）
- ✅ Organize imports（自动排序导入）

**配置**: `biome.json`（见后文）

#### TypeScript 类型检查（硬闸门）

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "typecheck:watch": "tsc --noEmit --watch"
  }
}
```

**CI 必须运行**: `pnpm typecheck` 失败则阻断合并

---

### 数据校验与类型一致性

#### Zod

```json
{
  "dependencies": {
    "zod": "^3.23.8"
  }
}
```

**用途**（ZeroLink 特定）:

1. **API Schema 定义**（`packages/shared/src/schemas.ts`）:
   ```typescript
   // 前后端共享，确保类型一致
   export const LockCommitRequestSchema = z.object({
     uuid: z.string().length(21),
     lock_challenge_id: z.string(),
     lock_proof: z.string().regex(/^[0-9a-f]{64}$/),
     receiver_pub_jwk: ReceiverPubJWKSchema,
     receiver_pub_fpr: z.string().regex(/^[0-9a-f]{64}$/),
     locked_at: z.number().int().positive()
   });

   export type LockCommitRequest = z.infer<typeof LockCommitRequestSchema>;
   ```

2. **运行时验证**:
   ```typescript
   // 前端：发送前自检
   const request = LockCommitRequestSchema.parse(data);

   // 后端：收到后防御
   const validated = LockCommitRequestSchema.safeParse(await req.json());
   if (!validated.success) {
     return Response.json({ ok: false }, { status: 400 });
   }
   ```

3. **表单输入验证**:
   ```typescript
   const PasswordSchema = z.string()
     .min(8, "密码至少 8 位")
     .max(128, "密码最多 128 位");
   ```

---

### Mock / 联调 / 测试一致性

#### MSW (Mock Service Worker)

```json
{
  "devDependencies": {
    "msw": "^2.4.0"
  }
}
```

**使用边界**（重要）:

| 场景 | 使用 MSW | 使用真实后端 |
|------|---------|-------------|
| 开发环境（UI 调试） | ✅ 可用 | ✅ 推荐（miniflare） |
| UI 组件测试 | ✅ 推荐 | ❌ 不需要 |
| 协议逻辑测试 | ❌ **禁止** | ✅ **必须** |
| E2E 测试 | ❌ **禁止** | ✅ **必须** |

**原因**: Canonical、lock_proof 等协议必须用真实后端验证，MSW 无法测出协议不一致的 bug。

**配置**:
```typescript
// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  // 仅 mock UI 层需要的接口
  http.post('/api/lock_begin/:uuid', () => {
    return HttpResponse.json({
      ok: true,
      lock_challenge_id: 'mock_challenge_id',
      lock_challenge: 'mock_challenge',
      expires_at: Date.now() + 60000
    });
  })
];
```

---

### 测试体系

#### Vitest

```json
{
  "devDependencies": {
    "vitest": "^4.0.18",
    "@vitest/ui": "^4.0.18",
    "@vitest/coverage-v8": "^4.0.18"
  }
}
```

**测试分层**:

1. **单元测试**（协议逻辑）:
   ```typescript
   // packages/shared/src/__tests__/canonical.test.ts
   import { ghostCanonV1 } from '../canonical';

   describe('Ghost Canon v1', () => {
     test('PRD 附录 B 测试向量：update', () => {
       const input = {
         op: "update",
         uuid: "u",
         version: 1,
         // ...
       };
       const expected = '{"cipher_bundle":{"aad":"aad",...}}';
       expect(ghostCanonV1(input)).toBe(expected);
     });
   });
   ```

2. **组件测试**（配合 React Testing Library）

#### React Testing Library

```json
{
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/user-event": "^14.5.2"
  }
}
```

**原则**: 以用户行为为中心，不测试内部实现。

```typescript
// packages/frontend/src/features/lock/__tests__/LockPage.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('显示 Safety Code 并允许复制', async () => {
  const user = userEvent.setup();
  render(<LockPage />);

  // 模拟上锁成功
  await user.type(screen.getByLabelText('密码'), 'test-password');
  await user.click(screen.getByRole('button', { name: '上锁' }));

  // 验证显示 Safety Code
  expect(screen.getByTestId('safety-code-emoji')).toBeInTheDocument();
});
```

#### Playwright

```json
{
  "devDependencies": {
    "@playwright/test": "^1.58.2"
  }
}
```

**E2E 测试场景**（ZeroLink 特定）:

1. **完整流程**:
   ```typescript
   // packages/frontend/e2e/create-lock-deliver.spec.ts
   import { test, expect } from '@playwright/test';

   test('完整流程：Create → Lock → Deliver → View', async ({ page, context }) => {
     // 1. Sender Create
     await page.goto('/');
     await page.click('text=创建');
     // WebAuthn 模拟
     const cdpSession = await context.newCDPSession(page);
     await cdpSession.send('WebAuthn.enable');
     // ...

     // 2. Receiver Lock
     const shareUrl = await page.locator('[data-testid="share-url"]').textContent();
     await page.goto(shareUrl);
     // ...

     // 3. Sender Deliver
     // ...

     // 4. Receiver View
     // ...
   });
   ```

2. **WebAuthn 测试**:
   ```typescript
   test('WebAuthn 不可用时显示降级引导', async ({ page }) => {
     // 禁用 WebAuthn
     await page.addInitScript(() => {
       delete (window.navigator as any).credentials;
     });

     await page.goto('/');
     expect(page.locator('text=换浏览器/设备（推荐）')).toBeVisible();
   });
   ```

---

### 包管理与工程化

#### pnpm + pnpm workspaces

```json
{
  "packageManager": "pnpm@9.12.0"
}
```

**pnpm-workspace.yaml**:
```yaml
packages:
  - 'packages/*'
```

**优势**（ZeroLink 相关）:
- ✅ 严格依赖管理（避免幽灵依赖导致的安全问题）
- ✅ 快速安装（节省 CI 时间）
- ✅ workspace 支持共享代码

---

### Git Hooks 与提交规范

#### Husky + lint-staged

```json
{
  "devDependencies": {
    "husky": "^9.1.0",
    "lint-staged": "^15.2.0"
  }
}
```

**配置**:
```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": [
      "biome check --write --no-errors-on-unmatched"
    ],
    "*.{json,md}": [
      "biome format --write"
    ]
  }
}
```

**.husky/pre-commit**:
```bash
#!/bin/sh
pnpm lint-staged
pnpm typecheck
```

#### commitlint + Conventional Commits

```json
{
  "devDependencies": {
    "@commitlint/cli": "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0"
  }
}
```

**commitlint.config.js**:
```javascript
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // 新功能
        'fix',      // Bug 修复
        'security', // 安全修复（ZeroLink 特定）
        'perf',     // 性能优化
        'refactor', // 重构
        'test',     // 测试
        'docs',     // 文档
        'chore',    // 构建/工具
        'revert'    // 回滚
      ]
    ]
  }
};
```

**示例提交**:
```bash
feat(lock): 实现 Lock Secret 防抢占锁定

- 添加 lock_secret 到 URL fragment
- 实现 lock_proof 计算逻辑
- 添加 lock_begin/lock_commit 两阶段流程

Refs: PRD § 附录 C
```

---

### 版本管理与发布流水线

#### PR 验证 + Tag 发布

当前仓库不再使用 Changesets，版本与发布流程由 GitHub Actions 驱动：

- `pull_request` / `merge_group` 运行 `pr-validate.yml`
- `push main` 自动部署 staging
- `push v*` tag 自动部署 production
- 官方签名发布会在部署前生成、签名并校验 `manifest.json`

**工作流**:
```bash
# 1. 开发并推送功能分支
git push origin <branch>

# 2. 等待 PR 验证通过
pnpm typecheck
pnpm test
pnpm --filter @zerolink/frontend build
pnpm --filter @zerolink/frontend test:e2e

# 3. 合并到 main 后自动部署 staging

# 4. 推送 tag 触发 production
git tag v1.0.0
git push origin v1.0.0
```

---

## Monorepo 结构

### 项目结构

```
ZeroLink/
├── packages/
│   ├── shared/                    # 共享代码（协议级一致性）
│   │   ├── src/
│   │   │   ├── constants.ts       # PRD 附录 A 常量
│   │   │   ├── canonical.ts       # Ghost Canon v1 实现
│   │   │   ├── schemas.ts         # Zod schemas（API 契约）
│   │   │   ├── types.ts           # 共享类型定义
│   │   │   ├── crypto/            # 密码学工具（可选共享）
│   │   │   │   ├── padding.ts
│   │   │   │   └── hash.ts
│   │   │   └── __tests__/
│   │   │       ├── canonical.test.ts
│   │   │       └── schemas.test.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   ├── frontend/                  # React 应用
│   │   ├── src/
│   │   │   ├── features/
│   │   │   │   ├── create/        # Sender Create
│   │   │   │   ├── lock/          # Receiver Lock
│   │   │   │   ├── deliver/       # Sender Deliver
│   │   │   │   └── view/          # Receiver View
│   │   │   ├── crypto/
│   │   │   │   ├── webauthn.ts
│   │   │   │   ├── hybrid-encrypt.ts
│   │   │   │   ├── kdf.ts         # Argon2id
│   │   │   │   └── storage.ts     # IndexedDB 包裹私钥
│   │   │   ├── api/
│   │   │   │   ├── client.ts
│   │   │   │   └── hooks.ts       # React Query hooks
│   │   │   ├── components/
│   │   │   │   ├── SafetyCode.tsx
│   │   │   │   └── WebAuthnPrompt.tsx
│   │   │   ├── stores/            # Zustand（可选）
│   │   │   ├── mocks/             # MSW handlers
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── e2e/                   # Playwright E2E
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── vitest.config.ts
│   │   └── playwright.config.ts
│   │
│   └── backend/                   # Cloudflare Workers
│       ├── src/
│       │   ├── index.ts           # Worker 入口
│       │   ├── do/                # Durable Objects
│       │   │   └── SecretDO.ts
│       │   ├── handlers/          # API handlers
│       │   │   ├── create.ts
│       │   │   ├── lock.ts
│       │   │   └── manage.ts
│       │   ├── crypto/
│       │   │   └── webauthn-verify.ts
│       │   └── __tests__/
│       ├── package.json
│       ├── wrangler.toml
│       └── vitest.config.ts
│
├── .husky/                        # Git hooks
├── docs/                          # 文档
├── biome.json                     # Biome 配置
├── pnpm-workspace.yaml
├── package.json                   # 根 package.json
└── tsconfig.base.json             # 基础 TypeScript 配置
```

### 包依赖关系

```
frontend  ──depends on──▶  shared
   │                         ▲
   │                         │
backend   ──depends on───────┘
```

**package.json 示例**:
```json
// packages/frontend/package.json
{
  "name": "@zerolink/frontend",
  "dependencies": {
    "@zerolink/shared": "workspace:*",
    "react": "^18.3.1",
    "zod": "^3.23.8"
  }
}

// packages/backend/package.json
{
  "name": "@zerolink/backend",
  "dependencies": {
    "@zerolink/shared": "workspace:*"
  }
}
```

---

## 密码学与安全

### 必须添加的依赖

#### Argon2id（KDF）

```json
{
  "dependencies": {
    "argon2-browser": "^1.18.0"
    // 或
    "@noble/hashes": "^1.5.0"  // 包含 argon2
  }
}
```

**使用**:
```typescript
// packages/frontend/src/crypto/kdf.ts
import { argon2id } from '@noble/hashes/argon2';

export async function wrapPrivateKey(
  privateKeyJWK: JsonWebKey,
  password: string
): Promise<WrappedKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Argon2id 参数（PRD 目标：250-500ms）
  const key = argon2id(password, salt, {
    m: 65536,  // 64MB
    t: 3,      // 3 iterations
    p: 1       // parallelism
  });

  // 用派生密钥包裹私钥（AES-GCM）
  // ...
}
```

#### WebAuthn 类型定义

```json
{
  "devDependencies": {
    "@github/webauthn-json": "^2.1.1"  // 简化 WebAuthn API
  }
}
```

#### Base64url 编码

```json
{
  "dependencies": {
    "base64-js": "^1.5.1"
    // 或自己实现（推荐，减少依赖）
  }
}
```

#### 可选：Identicon 生成

```json
{
  "dependencies": {
    "@dicebear/core": "^9.0.0",
    "@dicebear/collection": "^9.0.0"
  }
}
```

### 安全相关配置

#### Vite 配置（CSP + Verified Release）

```typescript
// packages/frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    headers: {
      // CSP（Content Security Policy）
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",  // 禁止 inline script
        "style-src 'self' 'unsafe-inline'",  // 暂时允许 inline style（React 需要）
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self' https://*.workers.dev",  // API 域名
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ].join('; '),

      // 安全头
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    }
  },

  build: {
    // 文件名包含 hash（便于 Verified Release 运行时校验）
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    },

    // 生成 sourcemap（调试用，生产环境不部署）
    sourcemap: true
  }
});
```

#### TypeScript 配置（严格模式）

```json
// tsconfig.base.json（根目录）
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,

    // 严格模式（必须）
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,

    // 路径映射（Monorepo）
    "baseUrl": ".",
    "paths": {
      "@zerolink/shared": ["./packages/shared/src"]
    },

    "skipLibCheck": true
  }
}
```

#### Biome 配置（代码规范）

```json
// biome.json（根目录）
{
  "$schema": "https://biomejs.dev/schemas/2.4.4/schema.json",
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error",
        "noDebugger": "error"
      },
      "security": {
        "noDangerouslySetInnerHtml": "error"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "useExhaustiveDependencies": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "es5",
      "semicolons": "always"
    }
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!templates/**", "!pnpm-lock.yaml"]
  }
}
```

---

## 开发工作流

### 初始化项目

```bash
# 1. 安装 pnpm（如果没有）
npm install -g pnpm

# 2. 初始化项目
mkdir ZeroLink && cd ZeroLink
pnpm init

# 3. 创建 Monorepo 结构
mkdir -p packages/{shared,frontend,backend}

# 4. 创建 pnpm-workspace.yaml
echo "packages:\n  - 'packages/*'" > pnpm-workspace.yaml

# 5. 初始化各个包
cd packages/shared && pnpm init
cd ../frontend && pnpm init
cd ../backend && pnpm init
cd ../..

# 6. 安装根依赖（工具链）
pnpm add -D -w \
  @biomejs/biome \
  husky lint-staged \
  @commitlint/cli @commitlint/config-conventional \
  typescript

# 7. 初始化 Git Hooks
pnpm exec husky init

# 8. 准备 CI / deploy workflow
# 使用仓库内现成的 .github/workflows/pr-validate.yml 与 deploy.yml
```

### 日常开发

```bash
# 安装依赖
pnpm install

# 开发模式（所有包并行）
pnpm -r --parallel dev

# 或单独运行前端
pnpm --filter @zerolink/frontend dev

# 类型检查
pnpm typecheck

# 代码检查和格式化
pnpm biome check --write .

# 运行测试
pnpm test                    # 所有包
pnpm --filter @zerolink/shared test  # 单个包

# E2E 测试
pnpm --filter @zerolink/frontend test:e2e
```

### CI 流水线（GitHub Actions 示例）

```yaml
# .github/workflows/pr-validate.yml
name: PR Validate

on:
  pull_request:
    branches: [main]
  merge_group:
    types: [checks_requested]

jobs:
  pr-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          package-manager-cache: false

      - run: corepack enable

      - run: pnpm install --frozen-lockfile

      - run: pnpm typecheck
      - run: pnpm test

  pr-build:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm --filter @zerolink/frontend build

  pr-e2e:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm --filter @zerolink/frontend test:e2e
```

---

## 质量闸门

### 本地开发（Pre-commit）

```
提交前自动运行：
1. lint-staged（仅检查 staged 文件）
   └─ biome check --write
2. typecheck（全量）
   └─ tsc --noEmit
```

### Pull Request（CI）

```
合并前必须通过：
1. ✅ pnpm typecheck（类型错误则失败）
2. ✅ pnpm test（单元测试失败则失败）
3. ✅ pnpm --filter @zerolink/frontend build（签名发布构建失败则失败）
4. ✅ pnpm --filter @zerolink/frontend test:e2e（E2E 测试失败则失败）
```

### 发布前（Release）

```
1. ✅ 所有 CI 检查通过
2. ✅ 手动验证部署说明与签名配置
3. ✅ 标记版本：git tag v1.0.0
4. ✅ 推送 tag：git push origin v1.0.0
5. ✅ 等待 `deploy.yml` 完成 production 发布
```

---

## 部署与发布

### 前端部署（Cloudflare Pages）

```bash
# 构建
pnpm --filter @zerolink/frontend build

# 输出目录：packages/frontend/dist

# Cloudflare Pages 配置
Build command: pnpm --filter @zerolink/frontend build
Build output directory: packages/frontend/dist
```

### 后端部署（Cloudflare Workers）

```bash
# 部署到 Cloudflare Workers
pnpm --filter @zerolink/backend deploy

# wrangler.toml 配置
# name = "zerolink-api"
# main = "src/index.ts"
# compatibility_date = "2024-01-01"
```

### 计费模型与限制 (Cost & Limits)

ZeroLink 核心逻辑依赖 **Cloudflare Durable Objects (DO)**。自 2026 年起，Cloudflare 为 DO 提供了完整的**免费层 (Free Tier)**，开发者无需付费订阅即可运行本项目。

| 计费项 | 免费层额度 (Free Plan) | 说明 |
|------|-------------------|------|
| **计算请求 (Requests)** | 100,000 次/日 | 超过限额后 DO 将停止响应直至次日重置 |
| **计算时长 (Duration)** | 12,800 GB-s/日 | 基于 wall-clock time 计费 (每个 DO 固定按 128MB 内存计算) |
| **SQLite 存储读取** | 5,000,000 行/日 | 本项目推荐并使用 SQLite 作为 DO 存储后端 |
| **SQLite 存储写入** | 100,000 行/日 | 包含原子性事务写入 |
| **总存储容量** | 5 GB | DO 持久化数据的总上限 |

**关键提示**:
1. **免费层限制**: 免费层仅支持 **SQLite 存储后端**。本项目已适配 SQLite。
2. **付费版 (Paid Plan)**: 如果需要更高额度或使用传统的 KV 存储后端，需开通 Workers Paid 计划（每月 $5 起）。
3. **休眠机制**: 本项目利用 WebSocket 自动休眠（Hibernation）降低计算时长消耗。

---

## 配置文件清单

### 根目录

```
ZeroLink/
├── package.json              # 根 package.json（工具链）
├── pnpm-workspace.yaml       # Monorepo 配置
├── tsconfig.base.json        # 基础 TS 配置
├── biome.json                # Biome 配置
├── commitlint.config.js      # Commitlint 配置
├── .husky/
│   ├── pre-commit
│   └── commit-msg
├── .github/workflows/pr-validate.yml  # PR CI
├── .github/workflows/deploy.yml       # staging / production deploy
└── .gitignore
```

### 各包配置

```
packages/shared/
├── package.json
├── tsconfig.json            # 继承 tsconfig.base.json
└── vitest.config.ts

packages/frontend/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── playwright.config.ts

packages/backend/
├── package.json
├── tsconfig.json
├── wrangler.toml
└── vitest.config.ts
```

---

## 依赖版本策略

### 固定版本 vs 范围版本

**原则**:
- **应用包**（frontend/backend）：使用 `^` 范围（自动升级小版本）
- **库包**（shared）：使用 `^` 范围（兼容性考虑）
- **密码学库**：考虑固定版本（安全审计需要）

**示例**:
```json
{
  "dependencies": {
    "react": "^18.3.1",           // 应用依赖：允许小版本升级
    "argon2-browser": "1.18.0",   // 密码学：固定版本
    "@zerolink/shared": "workspace:*"  // Monorepo 内部：workspace 协议
  }
}
```

### Renovate Bot 配置（可选）

```json
// renovate.json
{
  "extends": ["config:base"],
  "packageRules": [
    {
      "matchPackagePatterns": ["^argon2", "^@noble"],
      "matchUpdateTypes": ["major", "minor"],
      "automerge": false,
      "labels": ["security-review"]
    }
  ]
}
```

---

## 附录：完整 package.json 模板

### 根 package.json

```json
{
  "name": "zerolink",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "test:e2e": "pnpm --filter @zerolink/frontend test:e2e",
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check package.json biome.json commitlint.config.js pnpm-workspace.yaml packages docs scripts .husky",
    "format": "biome format --write package.json biome.json commitlint.config.js pnpm-workspace.yaml packages docs scripts .husky",
    "prepare": "husky"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.4",
    "@commitlint/cli": "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0",
    "husky": "^9.1.0",
    "lint-staged": "^15.2.0",
    "typescript": "^5.9.3"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json,md}": [
      "biome check --write --no-errors-on-unmatched"
    ]
  }
}
```

### packages/shared/package.json

```json
{
  "name": "@zerolink/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./constants": "./src/constants.ts",
    "./schemas": "./src/schemas.ts"
  },
  "scripts": {
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "vitest": "^4.0.18"
  }
}
```

### packages/frontend/package.json

```json
{
  "name": "@zerolink/frontend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@zerolink/shared": "workspace:*",
    "@noble/hashes": "^1.5.0",
    "@github/webauthn-json": "^2.1.1",
    "@radix-ui/react-slot": "^1.2.4",
    "@tailwindcss/vite": "^4.2.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-router-dom": "^7.13.1",
    "tailwind-merge": "^3.5.0",
    "tailwindcss": "^4.2.1",
    "zod": "^4.3.6",
    "zustand": "^5.0.11"
  },
  "devDependencies": {
    "@playwright/test": "^1.58.2",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.4",
    "@vitest/ui": "^4.0.18",
    "msw": "^2.12.10",
    "vite": "^7.3.1",
    "vitest": "^4.0.18"
  }
}
```

---

## 相关文档

- [PRD v3.0](./PRD.md) - 产品需求
- [架构设计](./ARCHITECTURE.md) - 系统架构
- [安全模型](./SECURITY.md) - 威胁模型
- [文档索引](./INDEX.md) - 快速导航

---

**最后更新**: 2026-03-11
**维护者**: ZeroLink Team
**状态**: ✅ 已落地，已按当前 main 分支流程更新
