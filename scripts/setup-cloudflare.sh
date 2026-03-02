#!/usr/bin/env bash
# =============================================================================
# ZeroLink — Cloudflare 一键配置脚本 / One-click Cloudflare setup script
#
# 用法 / Usage:
#   ./scripts/setup-cloudflare.sh [--dry-run]
#
# 功能 / Features:
#   1. 检查依赖（node, pnpm, wrangler）
#   2. 登录 Wrangler（如未登录）
#   3. 创建 KV namespace
#   4. 更新 packages/backend/wrangler.toml 中的 KV ID
#   5. 构建前后端
#   6. 部署 Worker（后端）
#   7. 部署 Pages（前端）
# =============================================================================

set -euo pipefail

# --- 颜色输出 / Color output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${BLUE}ℹ${RESET}  $*"; }
success() { echo -e "${GREEN}✓${RESET}  $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✗${RESET}  $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}==> $*${RESET}"; }

# --- 参数解析 / Argument parsing ---
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true; warn "Dry-run 模式：只打印命令，不执行" ;;
    --help|-h)
      echo "用法: $0 [--dry-run]"
      echo ""
      echo "选项:"
      echo "  --dry-run   只打印命令，不实际执行"
      echo "  --help      显示此帮助"
      exit 0
      ;;
  esac
done

run() {
  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[dry-run]${RESET} $*"
  else
    "$@"
  fi
}

# --- 脚本目录 / Script directory ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/packages/backend"
FRONTEND_DIR="${ROOT_DIR}/packages/frontend"
WRANGLER_TOML="${BACKEND_DIR}/wrangler.toml"

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════╗"
echo "║  ZeroLink — Cloudflare 部署配置向导      ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${RESET}"

# =============================================================================
# Step 1: 检查依赖 / Check dependencies
# =============================================================================
step "检查依赖"

check_cmd() {
  if command -v "$1" &>/dev/null; then
    success "$1 已安装 ($(command -v "$1"))"
  else
    error "$1 未找到，请先安装：$2"
  fi
}

check_cmd node  "https://nodejs.org"
check_cmd pnpm  "npm install -g pnpm"
check_cmd npx   "npm install -g npx"

# 检查 wrangler（允许通过 npx 使用）
if command -v wrangler &>/dev/null; then
  success "wrangler 已安装 ($(wrangler --version 2>/dev/null | head -1))"
elif npx wrangler --version &>/dev/null 2>&1; then
  success "wrangler 可通过 npx 使用"
  WRANGLER_CMD="npx wrangler"
else
  error "wrangler 未找到，请运行：npm install -g wrangler"
fi
WRANGLER_CMD="${WRANGLER_CMD:-wrangler}"

# Node.js 版本检查
NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  error "需要 Node.js 20+，当前版本：$NODE_VERSION"
fi
success "Node.js v$NODE_VERSION"

# =============================================================================
# Step 2: 登录 Wrangler / Login to Wrangler
# =============================================================================
step "验证 Wrangler 登录状态"

if $WRANGLER_CMD whoami &>/dev/null 2>&1; then
  WRANGLER_USER="已登录"
  success "已登录到 Cloudflare"
else
  info "需要登录 Cloudflare..."
  run $WRANGLER_CMD login
fi

# =============================================================================
# Step 3: 收集配置 / Collect configuration
# =============================================================================
step "配置 WebAuthn 参数"

echo ""
echo "WebAuthn 需要正确的域名配置，请根据你的部署方式选择："
echo "  - 自定义域名: zerolink.example.com"
echo "  - Workers.dev:  your-worker.username.workers.dev"
echo "  - Pages.dev:    your-project.pages.dev"
echo ""

read -r -p "请输入 RP_ID（域名，不含 https://）: " RP_ID
if [ -z "$RP_ID" ]; then
  error "RP_ID 不能为空"
fi

read -r -p "请输入 RP_ORIGIN（https://开头的完整 URL）: " RP_ORIGIN
if [ -z "$RP_ORIGIN" ]; then
  error "RP_ORIGIN 不能为空"
fi
if [[ "$RP_ORIGIN" != https://* ]]; then
  error "RP_ORIGIN 必须以 https:// 开头"
fi

echo ""
info "配置确认："
info "  RP_ID      = ${RP_ID}"
info "  RP_ORIGIN  = ${RP_ORIGIN}"
echo ""
read -r -p "确认以上配置？[y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  warn "已取消"
  exit 0
fi

# =============================================================================
# Step 4: 创建 KV Namespace / Create KV Namespace
# =============================================================================
step "创建 KV Namespace"

info "创建 SECRETS_KV namespace..."
KV_OUTPUT=$(run $WRANGLER_CMD kv:namespace create SECRETS_KV 2>&1 || true)

if [ "$DRY_RUN" = true ]; then
  KV_ID="dry-run-placeholder-id"
  warn "Dry-run 模式：跳过 KV ID 提取"
else
  echo "$KV_OUTPUT"
  # 从输出中提取 KV ID（POSIX 兼容，支持 macOS / Linux）
  KV_ID=$(echo "$KV_OUTPUT" | grep -o 'id = "[^"]*"' | grep -o '"[^"]*"' | tr -d '"' | head -1 || \
          echo "$KV_OUTPUT" | grep -oE '[0-9a-f]{32}' | head -1 || \
          echo "")

  if [ -z "$KV_ID" ]; then
    warn "无法自动提取 KV ID，请手动输入："
    echo "$KV_OUTPUT"
    read -r -p "请粘贴 KV namespace ID: " KV_ID
  fi

  if [ -z "$KV_ID" ]; then
    error "KV namespace ID 不能为空"
  fi
  success "KV namespace ID: ${KV_ID}"
fi

# =============================================================================
# Step 5: 更新 wrangler.toml / Update wrangler.toml
# =============================================================================
step "更新 wrangler.toml"

if [ "$DRY_RUN" = true ]; then
  warn "Dry-run: 跳过 wrangler.toml 更新"
else
  # 备份原始文件
  cp "$WRANGLER_TOML" "${WRANGLER_TOML}.bak"
  info "已备份到 ${WRANGLER_TOML}.bak"

  # 替换 KV ID
  if command -v sed &>/dev/null; then
    # macOS 和 Linux 兼容的 sed
    CURRENT_KV_ID=$(grep -o 'id = "[^"]*"' "$WRANGLER_TOML" | grep -o '"[^"]*"' | tr -d '"' | head -1 || \
                    echo "b8313bed33c9492885c12c9d26034420")

    if grep -q "$CURRENT_KV_ID" "$WRANGLER_TOML"; then
      sed -i.tmp "s/${CURRENT_KV_ID}/${KV_ID}/g" "$WRANGLER_TOML"
      rm -f "${WRANGLER_TOML}.tmp"
      success "已更新 KV namespace ID → ${KV_ID}"
    else
      warn "未找到原始 KV ID，请手动更新 ${WRANGLER_TOML}"
      warn "将 id 字段替换为: ${KV_ID}"
    fi
  fi
fi

# =============================================================================
# Step 6: 安装依赖并构建 / Install and build
# =============================================================================
step "安装依赖"
cd "$ROOT_DIR"
run pnpm install --frozen-lockfile

step "构建所有包"
run pnpm build

# =============================================================================
# Step 7: 部署 Worker / Deploy Worker
# =============================================================================
step "部署后端 Worker"
cd "$BACKEND_DIR"
run $WRANGLER_CMD deploy \
  --var "RP_ID:${RP_ID}" \
  --var "RP_ORIGIN:${RP_ORIGIN}"

success "Worker 部署完成！"

# =============================================================================
# Step 8: 部署前端 Pages / Deploy frontend Pages
# =============================================================================
step "部署前端到 Cloudflare Pages"

PAGES_PROJECT="zerolink-frontend"

# 检查项目是否已存在
if $WRANGLER_CMD pages project list 2>/dev/null | grep -q "$PAGES_PROJECT"; then
  info "Pages 项目 '${PAGES_PROJECT}' 已存在，直接部署..."
else
  info "创建 Pages 项目 '${PAGES_PROJECT}'..."
  run $WRANGLER_CMD pages project create "$PAGES_PROJECT"
fi

run $WRANGLER_CMD pages deploy "${FRONTEND_DIR}/dist" \
  --project-name "$PAGES_PROJECT" \
  --branch main

success "前端 Pages 部署完成！"

# =============================================================================
# 完成 / Done
# =============================================================================
echo ""
echo -e "${GREEN}${BOLD}"
echo "╔══════════════════════════════════════════╗"
echo "║          🎉 部署成功 / Deployed!          ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${RESET}"
echo ""
echo "后续步骤 / Next steps:"
echo "  1. 验证 Worker API: curl https://${RP_ID}/api/health"
echo "  2. 访问前端: https://${PAGES_PROJECT}.pages.dev"
echo "  3. 配置自定义域名: 参考 docs/DEPLOYMENT.md § 自定义域名"
echo "  4. 可选：配置 Manifest 签名: 参考 docs/DEPLOYMENT.md § Manifest 签名"
echo ""
echo "文档 / Documentation: docs/DEPLOYMENT.md"
