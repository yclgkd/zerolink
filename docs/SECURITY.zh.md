<!-- synced-with: c6d6bdc -->

> **语言**: [English](./SECURITY.md) | 中文

# ZeroLink 安全模型

## 威胁模型

### 假设（信任边界）

#### 我们信任：
- ✅ 用户的设备和浏览器（在用户控制下）
- ✅ Web Crypto API、WebAuthn API 的实现
- ✅ 系统/硬件密钥库（TPM、Secure Enclave、硬件钥匙）
- ✅ 密码学原语的安全性（AES-GCM、RSA-OAEP、SHA-256、Argon2id）

#### 我们不信任：
- ❌ 服务器（零知识设计）
- ❌ 网络传输（假设可被监听）
- ❌ 预加载爬虫/机器人
- ❌ 云端 passkey 同步（可选信任，见安全档位）

#### 边界：
- ⚠️ 恶意浏览器扩展/木马：可能滥用一次操作，但无法导出管理私钥
- ⚠️ 恶意服务器下发 JS：Web 架构固有风险，提供自托管/离线包缓解

---

## 安全目标与保证

### 1. 服务器零知识 ✅

**目标**：服务器/DO 不存明文与任何私钥

**保证**：
- 明文在客户端加密后才发送
- 接收方私钥在客户端生成，Argon2id 包裹后仅存本地
- 发送方管理私钥由 WebAuthn 管理（Secure Share：驻留系统/硬件）或本地生成 ECDSA 密钥编码在管理链接 fragment 中（Quick Share）
- lock_secret 只在 URL fragment，服务器只存 lock_key（单向派生）

**验证**：
- 审计服务器代码：不应有任何明文/私钥存储
- 检查 DO 存储：只有密文、公钥、hash、元数据

---

### 2. 端到端保密 ✅

**目标**：明文仅在接收方本地出现

**保证**：
- 混合加密：AES-256-GCM（内容）+ RSA-OAEP-256（密钥封装）
- 只有接收方持有 receiver_priv（密码派生，本地存储）
- 发送方也无法解密（只有 receiver_pub）

**攻击面**：
- 接收方密码弱：Argon2id（250-500ms）提高暴力破解成本
- 接收方设备被盗：密码保护 + 可选自动过期
- 中间人攻击：HTTPS + Safety Code 带外核对

---

### 3. 更新/销毁不可伪造 ✅

**目标**：仅管理者可授权写入/销毁

**保证**：
- 管理权基于 WebAuthn（Secure Share：私钥不可导出）或 ECDSA 签名（Quick Share：Argon2id 包裹的密钥在管理链接 fragment 中）
- 每次操作需要 WebAuthn 签名（Secure Share）或 ECDSA 签名（Quick Share）
- Intent Binding：challenge 绑定操作细节，防诱导签名

**验证** — 两种域分离的 challenge 推导：
```
intent_hash = SHA256(canonical_payload)  // 包含完整操作

// 投递/更新 — 确定性推导；服务端 challenge 一次性消费防重放
expected_challenge = SHA256("GL-delivery-proof" || uuid || intent_hash)

// 删除 — 服务端 nonce（challenge_id + seed）确保新鲜性
expected_challenge = SHA256("GLv2.5" || uuid || challenge_id || intent_hash || seed)
```

WebAuthn/ECDSA assertion 的 challenge 必须 === expected_challenge

---

### 4. 抗重放/乱序/并发覆盖 ✅

**目标**：所有写操作原子、有序、去重

**保证**：
- **Durable Objects**：串行化所有写操作
- **version**：单调递增，拒绝旧版本
- **nonce**：随机 24 bytes，DO 存储已用 nonce（TTL 10min），拒绝重复
- **timestamp**：窗口检查（±120s），防时间操控

**攻击面**：
- 重放攻击：nonce 去重
- 并发覆盖：DO 串行 + version 单调
- 乱序投递：version 检查

---

### 5. 最小元数据泄露 ✅

**目标**：公共接口只暴露前端运行所需的最小元数据，不暴露密文、管理凭据或明文密钥材料

**保证**：
- `/api/public/:uuid`：返回前端同步所需的最小公开状态快照（`state`、`adminMode`、`securityProfile`，以及上锁后才会出现的可选 `receiverPubFpr`），但不返回密文、管理凭据、`lock_secret` 或接收方公钥本体
- receiver_pub 仅在成功认证后返回给发送方
- 错误响应恒定形状：`{ok: false}`，不泄露细节
- Deleted/Expired 可统一返回 404

**信息泄露风险**：
- 密文长度：Padding 降低精度（4KB 块）
- 时序攻击：恒定响应格式 + Cache-Control: no-store

---

### 6. 前端完整性可验证 ✅

**目标**：前端代码未被篡改

**保证**：
- CSP 限制第三方脚本与跨源资源；运行时脚本保持同源，样式暂允许 `unsafe-inline`
- Signed Manifest + 同源运行时资源哈希校验，仅适用于启用了 `VITE_RELEASE_VERIFICATION_REQUIRED=true` 且同时发布签名产物的签名发布构建
- 零第三方脚本/字体
- 普通 `pnpm build` / 未签名手动部署仍可运行，但属于未验证启动
- 可复现构建 + 签名 Manifest（已落地到官方签名发布路径）

**边界**：
- 服务器下发恶意 JS：Web 架构固有风险
- 缓解：自托管 + 离线包 + Signed Manifest（针对签名发布路径）

---

### 7. 管理权私钥不可导出 ✅（Secure Share）

**目标**：攻击者无法长期窃取管理权（Secure Share：不可导出；Quick Share：密码保护）

**保证**：
- Secure Share：WebAuthn 私钥驻留系统密钥库/硬件
- 即使恶意扩展/木马，也只能滥用一次操作（需用户确认）
- 无法静默导出 Secure Share 管理私钥进行离线攻击

**Quick Share 边界**：
- Quick Share 本地生成 ECDSA 私钥，Argon2id 包裹后编码在管理链接的 URL fragment 中（不存 IndexedDB）
- 它是正式产品模式，不是降级兜底
- 任何拥有管理链接和频道密码的人可从任何设备管理频道，不提供 WebAuthn 的不可导出保证

---

### 8. TOFU 抢占锁定风险可控 ✅ (v2.5 核心)

**问题**：预加载爬虫/攻击者可能先于真实接收方访问链接并上锁

**v2.5 解决方案**：

#### Lock Secret（URL Fragment）
- lock_secret（32 bytes 随机）**只放在 URL fragment**
- Fragment 不会被 HTTP 请求携带（RFC 3986, Section 3.5）
- 预加载机器人访问 `/s/:uuid` 无法获得 lock_secret

#### Lock Key（服务器存储）
```
lock_key = SHA256("GL-lockkey" || uuid || lock_secret)
```
- 服务器只存 lock_key（不可逆回 lock_secret）
- 用于验证 lock_proof，但无法还原 lock_secret

#### Lock Challenge（防重放）
```
lock_begin → {lock_challenge_id, lock_challenge}  (一次性，TTL 60s)
lock_proof = SHA256("GL-lock" || uuid || challenge_id || challenge || lock_key)
lock_commit → 提交 lock_proof
```

#### 安全性质
- 没有 lock_secret → 无法计算 lock_key → 无法生成有效 lock_proof
- 即使窃取 lock_proof，也只能配合一次性 challenge 使用（重放失败）

#### UX 层补充
- Safety Code 带外核对（电话/另一个 IM）
- 但不再是唯一防线（协议层已硬修复）

---

### 9. 密文长度泄露显著降低 ✅ (v2.5)

**问题**：密文长度可能泄露明文长度信息（例如推断"密码"vs"长文本"）

**v2.5 解决方案**：

#### Padding 方案
```
padded_plaintext = [orig_len(4 bytes, big-endian)] + [orig_data] + [random_padding]
总长度 = ceil((4 + orig_len) / PAD_BLOCK) * PAD_BLOCK
默认 PAD_BLOCK = 4096 bytes
```

#### 安全性质
- 不同长度明文映射到离散桶（4KB 倍数）
- 泄露粒度降低到 4KB（或 8KB/16KB）
- padding 使用加密安全随机数
- 不引入 padding oracle（AES-GCM 自带认证）

#### 策略
- Quick Share：4KB 块（默认）
- Secure Share：8KB 块（更高隐私）
- Legacy strict/hardware_only：按 Secure Share 级别处理
- 超大文件（>1MB）：可关闭或使用更大块

---

## 产品模式（Current Profiles）

### Quick Share（密码）
- **适用**：无 WebAuthn 支持环境、跨设备/跨浏览器场景、希望使用密码管理器的用户
- **管理权**：本地 ECDSA P-256 管理密钥，Argon2id 包裹后编码在管理链接的 URL fragment 中（不存 IndexedDB）
- **Padding**：4KB
- **风险边界**：不具备 WebAuthn 的不可导出属性，密码强度与终端安全更关键

### Secure Share（Passkey）
- **适用**：希望使用系统/硬件 passkey 的较高安全场景
- **管理权**：WebAuthn，`userVerification = "required"`，`residentKey = "discouraged"`
- **Padding**：8KB
- **风险边界**：依然受 Web 场景恶意 JS 边界影响，但管理私钥不可导出

### Legacy（只读兼容）
- `standard`：Legacy WebAuthn 档位，UV=preferred（较低保障级别；与使用 ECDSA 的 Quick Share 架构不同）
- `strict` / `hardware_only`：Legacy WebAuthn 档位，UV=required（保障级别接近 Secure Share）
- 新建频道不再提供 legacy 档位

---

## 攻击场景分析

### 1. 网络窃听（被动攻击）

**威胁**：攻击者监听网络流量

**防护**：
- ✅ HTTPS 加密传输
- ✅ 服务器只存密文，窃听无法获得明文
- ✅ lock_secret 在 fragment（不传输）
- ⚠️ 密文长度泄露：Padding 降低精度

**残留风险**：
- 元数据（UUID、时间戳、IP）
- 密文长度桶（4KB 粒度）

---

### 2. 恶意服务器（主动攻击）

**威胁**：服务器运营者试图窃取内容

**防护**：
- ✅ 零知识设计：服务器无明文/私钥
- ✅ 端到端加密：只有接收方可解密
- ❌ 无法阻止：下发恶意 JS、拒绝服务

**缓解**：
- 🔒 自托管（完全控制服务器）
- 🔒 离线包 + 可验证发布链
- 🔒 Signed Manifest（检测篡改）

**边界**：
- Web 架构无法彻底解决"恶意下发 JS"
- 自托管是最高保证

---

### 3. TOFU 抢占锁定

**威胁**：预加载爬虫/攻击者先于真实接收方上锁

**v2.5 防护**：
- ✅ lock_secret 在 URL fragment（爬虫无法获取）
- ✅ lock_proof 基于 lock_key（服务器可验证但不可伪造）
- ✅ lock_challenge 一次性（防重放）

**攻击流程失败点**：
```
攻击者访问 /s/:uuid（无 fragment）
  → 调用 lock_begin 获得 challenge
  → 无法计算 lock_key（没有 lock_secret）
  → 无法生成有效 lock_proof
  → lock_commit 失败（403 Forbidden）
```

---

### 4. 中间人攻击（MITM）

**威胁**：攻击者劫持链接，替换 receiver_pub

**防护**：
- ✅ Safety Code 带外核对（Emoji/Color）
- ✅ lock_secret 在 fragment（HTTPS 不加密 fragment，但浏览器不发送）
- ⚠️ 依赖用户核对 Safety Code

**攻击流程**：
```
攻击者劫持分享链接
  → 替换为自己的 receiver_pub 上锁
  → Sender 投递时看到不同的 Safety Code
  → 带外核对失败 → 中止操作
```

**用户行为依赖**：
- 若用户不核对 Safety Code，攻击成功
- UX 需强提示（但不制造焦虑）

---

### 5. 恶意浏览器扩展/木马

**威胁**：用户设备被植入恶意软件

**防护**：
- ✅ WebAuthn 私钥不可导出（只能滥用一次）
- ✅ 每次操作需用户确认（限制自动化）
- ❌ 无法阻止：单次操作被滥用

**攻击流程**：
```
木马监听用户操作
  → 在用户确认窗口时拦截
  → 替换 payload 或触发一次恶意操作
  → 但无法导出私钥进行持续控制
```

**Quick Share 风险边界**：
- 本地 ECDSA 私钥用 Argon2id 包裹后编码在管理链接的 URL fragment 中（不存 IndexedDB），理论上比 Secure Share 更依赖终端安全
- UI 应引导用户设置足够强的密码，而不是将其表述为“降级模式”

---

### 6. 接收方密码暴力破解

**威胁**：攻击者窃取 wrapped_receiver_priv，离线暴力破解

**防护**：
- ✅ Argon2id KDF（目标耗时 250-500ms）
- ✅ 密码强度提示（UX 层）
- ⚠️ 用户仍可能使用弱密码

**破解成本**：
```
假设：
  - Argon2id 参数：m=64MB, t=3, p=1（约 500ms/次）
  - 攻击者硬件：现代 GPU（优化 Argon2id 困难，但仍比 PBKDF2 好）

弱密码（6 位数字）：
  - 空间：10^6 = 1,000,000
  - 成本：约 500,000 秒 ≈ 5.8 天（单线程）

强密码（12 位混合）：
  - 空间：95^12 ≈ 5.4 × 10^23
  - 成本：不可行
```

**残留风险**：
- 用户使用极弱密码（UX 需引导但不强制）

---

### 7. 服务器下发恶意 JS

**威胁**：服务器（或 CDN 劫持）下发篡改的前端代码

**防护**：
- ⚠️ Web 架构固有风险，无法彻底解决
- 🔒 CSP + Signed Manifest（提高篡改成本并检测篡改）
- 🔒 可复现构建 + Signed Manifest（可检测）
- 🔒 离线包（减少在线下发）
- 🔒 自托管（完全控制）

**攻击流程**：
```
攻击者控制服务器
  → 下发恶意 JS（窃取密码/私钥）
  → 用户无感知运行
  → 攻击成功
```

**缓解分层**：
1. **默认部署**（Cloudflare）：信任服务商
2. **离线包**：下载后本地运行（减少信任表面）
3. **自托管**：完全自主控制
4. **Signed Manifest**：用户可验证（需技术能力）

**边界**：
- 非技术用户难以验证前端完整性
- 提供工具 + 文档，但无法强制

---

## 密码学规范

### 对称加密（内容）
- **算法**：AES-256-GCM
- **密钥**：随机 256 bits（Web Crypto API 生成）
- **IV**：随机 96 bits（每次加密唯一）
- **AAD**：`uuid || version || receiver_pub_fpr`（防替换）
- **Tag**：128 bits（GCM 自带）

### 非对称加密（密钥封装）
- **算法**：RSA-OAEP-256
- **密钥长度**：2048 bits（接收方）
- **Hash**：SHA-256
- **用途**：封装 AES key

### KDF（密钥派生）
- **算法**：Argon2id（默认）
- **参数**：目标耗时 250-500ms
  - 推荐：m=64MB, t=3, p=1
- **Salt**：随机 128 bits
- **输出**：256 bits（用于 AES-256 包裹私钥）
- **降级**：PBKDF2-SHA256（仅 legacy compatibility 路径，迭代 600,000 次）

### 数字签名（管理权）
- **WebAuthn**：ES256（ECDSA P-256 + SHA-256）
- **Quick Share / Legacy Softkey**：ECDSA P-256
- **Update Delivery Proof**：`SHA256("GL-delivery-proof" || uuid || intent_hash)` 作为确定性 challenge；anchored channel 在接收端本地复验 proof

### 哈希（完整性/指纹）
- **算法**：SHA-256
- **用途**：
  - receiver_pub_fpr：SHA256(SPKI(receiver_pub))
  - sender_auth_fpr：SHA256(SPKI(sender_admin_verify_key))
  - ciphertext_hash：SHA256(ciphertext)
  - lock_key：SHA256("GL-lockkey" || uuid || lock_secret)
  - lock_proof：SHA256("GL-lock" || ...)
  - intent_hash：SHA256(canonical_payload)
  - delivery_proof_challenge：SHA256("GL-delivery-proof" || uuid || intent_hash)

---

## 协议常量

```typescript
// 域分隔符（Domain Separation）
const DOMAIN_PREFIX = {
  LOCK_KEY: "GL-lockkey",
  LOCK_PROOF: "GL-lock",
  DELIVERY_PROOF: "GL-delivery-proof",
  CHALLENGE: "GLv2.5",  // v2.5 专用前缀
};

// 时间窗口
const TIMESTAMP_SKEW_MS = 120000;    // ±2min
const CHALLENGE_TTL_MS = 60000;      // 60s
const NONCE_TTL_MS = 600000;         // 10min

// 随机数长度
const LOCK_SECRET_BYTES = 32;        // lock_secret
const LOCK_KEY_BYTES = 32;           // lock_key (SHA256 输出)
const CHALLENGE_BYTES = 32;          // challenge
const NONCE_BYTES = 24;              // nonce

// Padding
const PAD_BLOCK_DEFAULT = 4096;      // 4KB
const PAD_BLOCK_MAX = 65536;         // 64KB
const MAX_PLAINTEXT_BYTES = 2097152; // 2MB

// WebAuthn
const WEBAUTHN_ALG = -7;             // ES256
const WEBAUTHN_TIMEOUT_MS = 60000;   // 60s
```

---

## 安全检查清单（Implementation）

### 服务端
- [ ] 所有响应 `Cache-Control: no-store`
- [ ] lock_secret 永不入日志/存储
- [ ] lock_key 单向派生（不可逆）
- [ ] challenge 一次性消费（TTL + 标记）
- [ ] nonce 去重（TTL 10min）
- [ ] version 单调递增
- [ ] timestamp 窗口检查（±120s）
- [ ] WebAuthn 字节级验证（origin/challenge/signature）
- [ ] intent_hash 严格匹配
- [ ] 错误响应恒定形状 `{ok: false}`
- [ ] DO 串行化所有写操作

### 客户端
- [ ] lock_secret 只在 fragment（不发送到服务器）
- [ ] 新分享链接 fragment 额外携带 `af=sender_auth_fpr`
- [ ] lock_key 本地计算后回传（create_finish）
- [ ] lock_proof 包含 challenge（防重放）
- [ ] 接收方私钥用 Argon2id 包裹
- [ ] padding 随机安全（crypto.getRandomValues）
- [ ] AAD 绑定 uuid/version/fpr
- [ ] anchored channel 本地 pin `sender_auth_fpr`
- [ ] anchored channel 本地复验 `deliveryAuth` proof
- [ ] 本地持久化 `lastAcceptedDelivery(version,ciphertextHash)` 防回滚
- [ ] Safety Code 从 receiver_pub_fpr 确定性生成
- [ ] WebAuthn challenge 绑定 intent_hash
- [ ] 敏感数据清零（用后即焚）
- [ ] CSP 严格策略
- [ ] Signed Manifest 与运行时哈希校验

### UX
- [ ] 分享链接提示"必须完整复制（包括 # 后）"
- [ ] Safety Code 带外核对引导（不制造焦虑）
- [ ] 接收方防呆动画（"密码只在你这里"）
- [ ] Quick Share 与 Secure Share 的差异说明准确，不把 Quick Share 写成“兼容模式”
- [ ] WebAuthn 失败给明确降级引导
- [ ] 密码强度提示（但不强迫）

---

## 已知限制与未来改进

### 已知限制
1. **元数据泄露**：UUID、时间戳、密文长度桶
2. **用户行为依赖**：Safety Code 核对非强制
3. **恶意下发 JS**：Web 架构固有问题（缓解：自托管）
4. **弱密码风险**：无法强制用户使用强密码
5. **模式差异**：Quick Share 更依赖密码与本地终端安全；Secure Share 更依赖 WebAuthn 生态
6. **新鲜性边界**：anchored A+B 只能防本设备回滚和未锚定 sender proof 的伪造，仍不能单独证明“服务器没有藏起更新”；那需要未来的 witness / transparency 方案

### 未来改进
- 🔮 **E2EE 文件分享**：大文件分片 + 流式加密
- 🔮 **多接收方**：群组加密（每人一个 enc_content_key）
- 🔮 **可撤销链接**：发送方销毁后接收方无法解密
- 🔮 **Forward Secrecy**：定期轮换 AES key（更新时重新加密）
- 🔮 **硬件 Attestation**：强制验证硬件密钥属性
- 🔮 **去中心化**：IPFS + 智能合约（彻底去除服务器信任）

---

## 安全审计建议

### 审计重点
1. **lock_secret 不泄露**：检查所有代码路径，确保不上传/不入日志
2. **lock_proof 验证逻辑**：确保无法伪造（需 lock_key）
3. **WebAuthn 验证**：字节级精确匹配（origin/challenge/signature）
4. **DO 原子性**：并发测试（version/nonce 冲突）
5. **padding 正确性**：长度计算、随机性、去 padding 逻辑
6. **Argon2id 参数**：确保符合 OWASP 建议（2023）

### 测试向量
见 PRD 附录 B（Canonical）、附录 C（Lock）、附录 E（Padding）

### 渗透测试场景
- TOFU 抢占（无 fragment 尝试 lock）
- challenge 重放（同 challenge_id 多次提交）
- nonce 重放（同 nonce 多次提交）
- version 回退（提交旧 version）
- timestamp 操控（超出窗口）
- intent_hash 篡改（替换 payload）

---

## 参考资料

- **WebAuthn 规范**：https://www.w3.org/TR/webauthn-2/
- **Argon2 RFC**：https://datatracker.ietf.org/doc/html/rfc9106
- **OWASP Password Storage**：https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- **URL Fragment 语义**：https://datatracker.ietf.org/doc/html/rfc3986#section-3.5
- **完整 PRD**：[PRD.md](./PRD.zh.md)
- **架构概览**：[ARCHITECTURE.md](./ARCHITECTURE.zh.md)
