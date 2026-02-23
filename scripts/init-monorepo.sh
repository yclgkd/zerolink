#!/bin/bash
# ZeroLink Monorepo 初始化脚本
# 用法: ./scripts/init-monorepo.sh

set -e  # 遇到错误立即退出

echo "🚀 ZeroLink Monorepo 初始化开始..."
echo ""

# 检查 pnpm
if ! command -v pnpm &> /dev/null; then
    echo "❌ 错误: 未找到 pnpm"
    echo "请先安装: npm install -g pnpm@9"
    exit 1
fi

echo "✅ 检测到 pnpm $(pnpm --version)"
echo ""

# 1. 复制配置文件到根目录
echo "📁 步骤 1/7: 复制配置文件..."
cp -n templates/pnpm-workspace.yaml . 2>/dev/null || echo "  ⏭️  pnpm-workspace.yaml 已存在"
cp -n templates/tsconfig.base.json . 2>/dev/null || echo "  ⏭️  tsconfig.base.json 已存在"
cp -n templates/biome.json . 2>/dev/null || echo "  ⏭️  biome.json 已存在"
cp -n templates/commitlint.config.js . 2>/dev/null || echo "  ⏭️  commitlint.config.js 已存在"
cp -n templates/.gitignore . 2>/dev/null || echo "  ⏭️  .gitignore 已存在"

# 根 package.json 特殊处理（不覆盖已有的）
if [ ! -f package.json ]; then
    cp templates/package.json .
    echo "  ✅ package.json 已创建"
else
    echo "  ⏭️  package.json 已存在（不覆盖）"
fi

# 2. 创建 Monorepo 结构
echo ""
echo "📂 步骤 2/7: 创建目录结构..."
mkdir -p packages/{shared,frontend,backend}
mkdir -p packages/shared/src/{__tests__,crypto}
mkdir -p packages/frontend/{src,e2e,public}
mkdir -p packages/frontend/src/{features,crypto,api,components,stores,mocks}
mkdir -p packages/backend/src/{do,handlers,crypto}
echo "  ✅ 目录结构已创建"

# 3. 创建 shared 包
echo ""
echo "📦 步骤 3/7: 初始化 @zerolink/shared..."
if [ ! -f packages/shared/package.json ]; then
    cat > packages/shared/package.json << 'EOF'
{
  "name": "@zerolink/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./constants": "./src/constants.ts",
    "./schemas": "./src/schemas.ts",
    "./types": "./src/types.ts"
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
    echo "  ✅ package.json 已创建"
else
    echo "  ⏭️  package.json 已存在"
fi

if [ ! -f packages/shared/tsconfig.json ]; then
    cat > packages/shared/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "types": ["vitest/globals", "node"]
  },
  "include": ["src"]
}
EOF
    echo "  ✅ tsconfig.json 已创建"
fi

# 创建占位文件
touch packages/shared/src/index.ts
touch packages/shared/src/constants.ts
touch packages/shared/src/schemas.ts
touch packages/shared/src/types.ts

# 4. 创建 frontend 包
echo ""
echo "⚛️  步骤 4/7: 初始化 @zerolink/frontend..."
if [ ! -f packages/frontend/package.json ]; then
    cat > packages/frontend/package.json << 'EOF'
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
    echo "  ✅ package.json 已创建"
fi

if [ ! -f packages/frontend/vite.config.ts ]; then
    cat > packages/frontend/vite.config.ts << 'EOF'
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
    echo "  ✅ vite.config.ts 已创建"
fi

if [ ! -f packages/frontend/index.html ]; then
    cat > packages/frontend/index.html << 'EOF'
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ZeroLink - 零知识秘密分享</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF
    echo "  ✅ index.html 已创建"
fi

# 5. 创建 backend 包
echo ""
echo "☁️  步骤 5/7: 初始化 @zerolink/backend..."
if [ ! -f packages/backend/package.json ]; then
    cat > packages/backend/package.json << 'EOF'
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
    echo "  ✅ package.json 已创建"
fi

# 6. 安装依赖
echo ""
echo "📥 步骤 6/7: 安装依赖（这可能需要几分钟）..."
pnpm install

# 7. 初始化 Git Hooks
echo ""
echo "🪝 步骤 7/7: 初始化 Git Hooks..."
if [ -d .git ]; then
    pnpm exec husky init

    # pre-commit
    cat > .husky/pre-commit << 'EOF'
pnpm lint-staged
pnpm typecheck
EOF
    chmod +x .husky/pre-commit

    # commit-msg
    cat > .husky/commit-msg << 'EOF'
pnpm commitlint --edit $1
EOF
    chmod +x .husky/commit-msg

    echo "  ✅ Git Hooks 已设置"
else
    echo "  ⏭️  未检测到 .git 目录，跳过 Git Hooks 设置"
fi

# 初始化 Changesets
if [ ! -d .changeset ]; then
    pnpm changeset init
    echo "  ✅ Changesets 已初始化"
fi

echo ""
echo "🎉 初始化完成！"
echo ""
echo "📚 下一步:"
echo "  1. 查看文档: cat docs/QUICK_START.md"
echo "  2. 开始开发: pnpm dev"
echo "  3. 运行测试: pnpm test"
echo ""
echo "💡 提示: 参考 docs/TECH_STACK.md 了解技术栈详情"
