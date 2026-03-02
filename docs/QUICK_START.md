# ZeroLink 快速启动指南

> 从零到运行开发环境的完整步骤

---

## 前置要求

### 必须安装

- **Node.js**: >= 20.0.0
- **pnpm**: >= 9.0.0

```bash
# 检查版本
node --version  # v20.x.x
pnpm --version  # 9.x.x
```

### 如果没有 pnpm

```bash
npm install -g pnpm@9
```

---

## 快速初始化（推荐）

### 选项 1：使用初始化脚本

```bash
# 在项目根目录运行
chmod +x scripts/init-monorepo.sh
./scripts/init-monorepo.sh
```

脚本会自动：
1. ✅ 复制配置文件到根目录
2. ✅ 创建 Monorepo 目录结构
3. ✅ 初始化各 package.json
4. ✅ 安装依赖
5. ✅ 设置 Git Hooks

### 选项 2：手动初始化

跟随下面的"手动步骤"章节。

---

## 手动步骤

### 1. 复制配置文件

```bash
# 在项目根目录
cp templates/pnpm-workspace.yaml .
cp templates/tsconfig.base.json .
cp templates/biome.json .
cp templates/package.json .
cp templates/commitlint.config.js .
cp templates/.gitignore .
```

### 2. 创建 Monorepo 结构

```bash
mkdir -p packages/{shared,frontend,backend}
```

### 3. 初始化 shared 包

```bash
cd packages/shared

# 创建 package.json
cat > package.json << 'EOF'
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
    "vitest": "^2.1.0"
  }
}
EOF

# 创建 tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "types": ["vitest/globals", "node"]
  },
  "include": ["src"]
}
EOF

# 创建源码目录和文件
mkdir -p src/__tests__
touch src/index.ts src/constants.ts src/schemas.ts src/types.ts

cd ../..
```

### 4. 初始化 frontend 包

```bash
cd packages/frontend

# 创建 package.json
cat > package.json << 'EOF'
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
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "zod": "^3.23.8",
    "zustand": "^4.5.0",
    "@noble/hashes": "^1.5.0",
    "@github/webauthn-json": "^2.1.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "@vitest/ui": "^2.1.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/user-event": "^14.5.2",
    "@playwright/test": "^1.48.0",
    "msw": "^2.4.0"
  }
}
EOF

# 创建 vite.config.ts（基础版）
cat > vite.config.ts << 'EOF'
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
EOF

# 创建目录结构
mkdir -p src/{features,crypto,api,components,stores,mocks}
mkdir -p e2e public

cd ../..
```

### 5. 初始化 backend 包

> **提示**: ZeroLink 后端使用 Cloudflare Durable Objects。
> 自 2026 年起，Durable Objects 已提供**免费层 (Free Tier)**（每日 10 万次请求 + 5GB SQLite 存储），使用免费 Cloudflare Workers 账号即可开始开发，无需绑定信用卡或订阅。

```bash
cd packages/backend
...
# 创建 package.json
cat > package.json << 'EOF'
{
  "name": "@zerolink/backend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@zerolink/shared": "workspace:*"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240925.0",
    "wrangler": "^3.78.0",
    "vitest": "^2.1.0"
  }
}
EOF

# 创建 wrangler.toml
cat > wrangler.toml << 'EOF'
name = "zerolink-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "SECRET_DO", class_name = "SecretDO" }
]

[[migrations]]
tag = "v1"
new_classes = ["SecretDO"]

[[kv_namespaces]]
binding = "SECRETS_KV"
id = "your-kv-namespace-id"  # 运行 wrangler kv:namespace create SECRETS_KV 获取
EOF

# 创建目录结构
mkdir -p src/{do,handlers,crypto}

cd ../..
```

### 6. 安装依赖

```bash
# 回到根目录
pnpm install
```

### 7. 初始化 Git Hooks

```bash
# 初始化 husky
pnpm exec husky init

# 创建 pre-commit hook
cat > .husky/pre-commit << 'EOF'
pnpm lint-staged
pnpm typecheck
EOF
chmod +x .husky/pre-commit

# 创建 commit-msg hook
cat > .husky/commit-msg << 'EOF'
pnpm commitlint --edit $1
EOF
chmod +x .husky/commit-msg
```

### 8. 初始化 Changesets

```bash
pnpm changeset init
```

---

## 验证安装

```bash
# 类型检查（应该没有错误，只是一些空文件警告）
pnpm typecheck

# 代码检查
pnpm lint

# 测试（目前没有测试，会快速通过）
pnpm test
```

---

## 开始开发

### 启动所有包（并行）

```bash
pnpm dev
```

这会同时启动：
- Frontend (Vite dev server): http://localhost:5173
- Backend (Wrangler dev): http://localhost:8787

### 或单独启动

```bash
# 仅前端
pnpm --filter @zerolink/frontend dev

# 仅后端
pnpm --filter @zerolink/backend dev
```

---

## 下一步

### 1. 实现 shared 包的核心代码

按照 [TECH_STACK.md](./TECH_STACK.md) 的指导：

```bash
cd packages/shared/src

# 1. 常量定义（PRD 附录 A）
# 编辑 constants.ts

# 2. Canonical 实现（PRD 附录 B）
# 创建 canonical.ts

# 3. Zod Schemas（API 契约）
# 编辑 schemas.ts
```

### 2. 参考文档

- [PRD v2.5](./PRD-v2.5.md) - 查看协议细节
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 理解整体架构
- [SECURITY.md](./SECURITY.md) - 了解安全要求
- [TECH_STACK.md](./TECH_STACK.md) - 技术栈详细说明

### 3. 推荐的开发顺序

```
第 1 周：基础设施
  Day 1-2: shared 包（constants + canonical + schemas）
  Day 3-4: Frontend 路由 + 基础组件
  Day 5-7: Backend DO + 基础 API

第 2 周：核心流程
  Day 1-3: Create 流程（WebAuthn）
  Day 4-5: Lock 流程（Lock Secret）
  Day 6-7: Deliver 流程（混合加密）

第 3 周：完善与测试
  Day 1-2: Safety Code UI
  Day 3-4: E2E 测试
  Day 5-7: 安全审查 + 文档
```

---

## 常见问题

### Q: pnpm install 失败

```bash
# 清除缓存重试
pnpm store prune
pnpm install --force
```

### Q: TypeScript 报错找不到 @zerolink/shared

确保：
1. `pnpm-workspace.yaml` 在根目录
2. 运行过 `pnpm install`（会创建 workspace 链接）
3. `tsconfig.base.json` 的 paths 配置正确

### Q: Husky hooks 不生效

```bash
# 重新初始化
rm -rf .husky
pnpm exec husky init
# 然后手动重新创建 hooks（见上文"初始化 Git Hooks"）
```

### Q: 想用其他包管理器（npm/yarn）

不推荐，因为：
- workspace 协议不兼容
- lockfile 格式不同
- 速度明显慢于 pnpm

如果坚持，需要修改所有 workspace:* 为相对路径。

---

## 进阶配置

### 添加 VS Code 配置（可选）

```bash
mkdir -p .vscode

cat > .vscode/settings.json << 'EOF'
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "quickfix.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
EOF

cat > .vscode/extensions.json << 'EOF'
{
  "recommendations": [
    "biomejs.biome",
    "bradlc.vscode-tailwindcss",
    "ms-playwright.playwright"
  ]
}
EOF
```

### 添加 CI 配置（GitHub Actions）

```bash
mkdir -p .github/workflows

cat > .github/workflows/ci.yml << 'EOF'
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm biome ci .
      - run: pnpm typecheck
      - run: pnpm test
EOF
```

---

**准备好了吗？运行 `pnpm dev` 开始开发吧！** 🚀
