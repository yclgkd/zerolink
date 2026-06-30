<!-- synced-with: 940a85a -->

> **语言**: [English](./VERIFY.md) | 中文

# 已验证发布与构建完整性验证

ZeroLink 在每次发布时都会发布一份**签名构建清单**，官方签名前端构建会在 React 应用加载前的启动阶段使用该清单。这使得浏览器能在用户与敏感界面交互之前，检测已发布运行时资产是否被篡改。

## 验证内容

- **Ed25519 签名** — `manifest.sig` 是使用 ZeroLink 签名密钥对 `manifest.json` 进行的密码学签名。
- **已签名入口绑定** — `manifest.json` 在 `entryAssetPath` 中记录了预期的启动入口 bundle 路径，若当前执行的入口资产与之不匹配，浏览器将拒绝信任该发布版本。
- **运行时文件哈希** — `manifest.json` 列出了 `dist/assets/` 下稳定运行时构建产物的 SHA-256 哈希，包括带哈希文件名的 JS、CSS、字体及其他不可变资产文件。
- **Manifest 哈希** — `manifest-hash.txt` 包含 `manifest.json` 自身的 SHA-256；它在应用的 **Verified Release** 卡片中作为公开指纹展示，而非信任锚点。

`_headers`、`_redirects` 等 Pages 控制文件被有意排除在签名运行时清单之外，因为它们是部署元数据，而非浏览器获取的发布资产。`index.html`、`robots.txt`、图标等根文档及其他非资产文件同样被排除。SPA 入口文档 `index.html` 尤其不签名，因为边缘平台可能向启动 shell 注入请求相关的 HTML，即使底层部署正常，也会导致该文档的逐字节签名不稳定。

## 浏览器启动时的行为

当部署使用 `VITE_RELEASE_VERIFICATION_REQUIRED=true` 构建时，ZeroLink 会先运行一个小型启动入口，而非立即加载 React 应用。该启动入口会：

1. 获取 `manifest.json` 和 `manifest.sig`
2. 使用内嵌公钥验证 Ed25519 签名
3. 确认当前执行的启动入口 bundle 与 `manifest.entryAssetPath` 匹配
4. 对已签名的同源运行时资产重新计算哈希
5. 仅在所有检查通过后才加载 React 应用

若验证失败或无法完成，ZeroLink 会显示阻塞验证界面，不加载正常应用 UI。若入口 bundle 与签名清单不匹配，ZeroLink 会在关闭前尝试一次受控页面重载，以从陈旧的入口 HTML 或入口 bundle 缓存中恢复，同时避免无限循环。

普通 `pnpm build`、`vite preview` 或未附带签名发布产物的手动静态上传等未签名环境仍可运行，但会被视为未验证启动，不显示 `Verified Release` 卡片。

## 每次发布的产物

| 文件 | 说明 |
|------|------|
| `dist/manifest.json` | 包含 `entryAssetPath` 及文件哈希的签名构建清单 |
| `dist/manifest-hash.txt` | `manifest.json` 的 SHA-256 |
| `dist/manifest.sig` | 对 `manifest.json` 的 Ed25519 签名 |
| `keys/manifest-signing.pub` | 用于验证的公钥（已提交至本仓库） |

发布工作流使用 `VITE_RELEASE_VERIFICATION_REQUIRED=true` 构建前端，生成签名清单，并通过 `wrangler deploy`（Cloudflare Workers）部署。

## 浏览器信任界面

启动验证成功后，shell 会渲染一张 `Verified Release` 卡片，显示：

- 应用版本
- 构建日期
- 提交哈希
- Manifest 哈希
- 已验证文件数量
- 发布者密钥指纹

Worker 对 SPA 入口请求返回 `Cache-Control: no-store`，确保 HTML/启动 shell 不会跨部署复用，而带哈希的 `/assets/*` 文件则保持不可变。签名清单有意限定为 `dist/assets/*` 运行时构建产物；HTML 文档本身不参与哈希，但它启动的启动入口资产仍须与签名清单匹配。

对于 GitHub Actions 部署，清单的 `version` 字段通过 `ZEROLINK_VERSION` 由 CI 注入：正式发布使用推送的 `v*` 标签（去掉前缀 `v`），staging 构建使用 `0.0.0-dev+<short_sha>`。本地/手动构建在该环境变量未设置时回退到 `packages/frontend/package.json`。

## 快速验证（自动化）

将发布构建下载到 `packages/frontend/dist/` 后：

```bash
pnpm manifest:verify
```

该命令将：
1. 读取 `manifest.json`、`manifest.sig` 和 `keys/manifest-signing.pub`
2. 验证 Ed25519 签名
3. 确认 `index.html` 启动的入口资产与 `manifest.entryAssetPath` 中记录的一致
4. 对每个已签名运行时文件重新计算哈希并与 `manifest.json` 比对
5. 打印每个文件的通过/失败结果

## 手动验证

### 1. 验证 Ed25519 签名

```bash
# 将 base64url 签名解码为二进制（补充所需的 = 填充）
SIG=$(cat packages/frontend/dist/manifest.sig | tr -d '\n' | \
  tr -- '-_' '+/' | \
  awk '{ l=length($0); pad=(4-l%4)%4; printf "%s%.*s\n", $0, pad, "====" }' | \
  base64 --decode)

# 使用 openssl 验证
openssl pkeyutl \
  -verify \
  -pubin \
  -inkey keys/manifest-signing.pub \
  -sigfile <(printf '%s' "$SIG") \
  -in packages/frontend/dist/manifest.json
```

### 2. 验证特定文件哈希

```bash
# 检查某个已签名运行时资产
# 注意：Vite 输出带内容哈希的文件名，如 index-Abc123.js
sha256sum packages/frontend/dist/assets/index-*.js
# 与 manifest.json 中的值比对（使用实际的带哈希文件名）：
jq '.files | to_entries[] | select(.key | startswith("assets/index-"))' \
  packages/frontend/dist/manifest.json
```

### 3. 验证 Manifest 哈希

```bash
sha256sum packages/frontend/dist/manifest.json
cat packages/frontend/dist/manifest-hash.txt
# 两者应一致
```

## 公钥指纹

要确认使用的是正确的公钥，计算其指纹：

```bash
openssl pkey -in keys/manifest-signing.pub -pubin -outform DER | sha256sum
```

将输出结果与应用 `Verified Release` 卡片中显示的指纹或 `keys/manifest-signing.pub` 中列出的指纹进行比对。

## 密钥轮换

若签名密钥发生轮换，新公钥将提交至 `keys/manifest-signing.pub`，并在发布说明中公告。旧签名对旧版本仍然有效。

## 报告问题

若已发布版本的验证失败，请在 <https://github.com/yclgkd/zerolink/security> 提交安全问题。
