<!-- synced-with: c6d6bdc -->

> **语言**: [English](./ARCHITECTURE.md) | 中文

# ZeroLink 架构概览

## 核心架构原则

### 1. 零知识架构
- **服务器不存明文**：所有内容在客户端加密，服务器只存储密文
- **服务器不存私钥**：接收方私钥在客户端生成并本地存储（Argon2id 包裹）
- **双路径管理权**：Secure Share 使用 WebAuthn（私钥驻留系统/硬件）；Quick Share 使用密码包裹的本地 ECDSA 密钥

### 2. 三方角色模型

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Sender     │         │   Server     │         │  Receiver    │
│  (管理者)     │         │  (零知识)     │         │  (唯一解密)   │
├──────────────┤         ├──────────────┤         ├──────────────┤
│ WebAuthn Key │────────▶│  Ciphertext  │◀────────│  RSA-OAEP    │
│ (不可导出)    │  管理    │  (无明文)     │  解密    │  私钥本地     │
│              │         │              │         │  (Argon2id)  │
│ 可更新/销毁   │         │  DO 原子性    │         │  单向密码派生  │
│ 但不能解密    │         │  防并发覆盖   │         │              │
└──────────────┘         └──────────────┘         └──────────────┘
```

### 3. 技术栈

#### 前端
- **运行时**：浏览器 Web Crypto API
- **认证**：WebAuthn（FIDO2）
- **加密**：
  - 内容：AES-256-GCM（对称加密）
  - 密钥封装：RSA-OAEP-256（混合加密）
  - KDF：Argon2id（接收方私钥包裹）
- **存储**：IndexedDB（加密私钥）

#### 后端
- **平台**：Cloudflare Workers + Durable Objects
- **状态管理**：Durable Objects（串行化、原子性）
- **持久化**：DO 存储 / SQLite（密文、公钥、元数据）
- **自托管选项**：Docker Compose（PostgreSQL/SQLite + Redis）（计划中，尚未实现）

## 核心协议流程

### 1. Create（创建）
```
Sender → 选择 Quick Share 或 Secure Share → 生成 lock_secret
     → Quick Share：本地生成 ECDSA 管理密钥并用 Argon2id 包裹
     → Secure Share：WebAuthn 注册管理凭据
     → 返回两条链接：
       - /s/:uuid#k=<lock_secret>[&af=<sender_auth_fpr>]  （分享链接；af= 在存在发送者身份指纹时附加）
       - /m/:uuid#wk=<wrapped_priv> （管理链接；Quick Share — fragment 携带 Argon2id 包裹的 Admin-Priv）
       - /m/:uuid                   （管理链接；Secure Share — 无需 fragment）
```

### 2. Lock（接收方上锁）
```
Receiver → 访问分享链接（获得 fragment 中的 lock_secret）
        → 输入密码 → 生成 RSA keypair
        → 私钥用 Argon2id(密码) 包裹存本地
        → lock_begin 获取 challenge
        → lock_commit 提交 receiver_pub + lock_proof
        → Server 验证 lock_proof（基于 lock_key）
```

**TOFU 抢占锁定防护**：
- lock_secret 只在 URL fragment（不会被 HTTP 请求携带）
- 预加载爬虫无法获得 lock_secret → 无法计算 lock_proof → 无法 lock

### 3. Deliver（投递内容）
```
Sender → 获取 receiver_pub（已上锁）
      → 本地混合加密：
        - 随机 AES-256 key
        - AES-GCM 加密 padded_plaintext
        - RSA-OAEP 封装 AES key
      → compound_begin 获取 challenge
      → Secure Share: WebAuthn 签名确认
      → Quick Share: 本地 ECDSA 签名确认
      → compound_commit 写入密文（原子性）
```

### 4. Update/Delete（管理）
```
Sender → Secure Share: WebAuthn 签名授权
      → Quick Share: 本地 ECDSA 签名授权
      → DO 验证：version 单调 + nonce 去重
      → 原子性更新/删除
```

## 安全机制

### 1. TOFU 抢占锁定防护（v2.5 核心）

**问题**：预加载机器人可能先于真实接收方访问链接并上锁

**解决方案**：
- `lock_secret`（32 bytes 随机）只放在 URL fragment
- Fragment 不会被 HTTP 请求携带（RFC 3986）
- Server 存储 `lock_key = SHA256("GL-lockkey" || uuid || lock_secret)`
- Lock 时需要 `lock_proof = SHA256("GL-lock" || uuid || challenge_id || challenge || lock_key)`
- 没有 lock_secret → 无法计算 lock_key → 无法生成有效 lock_proof

### 2. 密文长度泄露缓解（Padding）

**问题**：密文长度可能泄露明文长度信息

**解决方案**：
```
padded_plaintext = [orig_len(4 bytes)] + [orig_data] + [random_padding]
总长度 = ceil((4 + orig_len) / PAD_BLOCK) * PAD_BLOCK
默认 PAD_BLOCK = 4096 bytes
```

### 3. 并发安全（Durable Objects）

**问题**：多个并发请求可能导致状态不一致

**解决方案**：
- 所有写操作走 DO（串行化）
- version 单调递增
- nonce 去重（TTL 10min）
- challenge 一次性消费

### 4. Intent Binding（意图绑定）

**问题**：WebAuthn 签名可能被诱导签署意外操作

**解决方案**：两种域分离的 challenge 推导，取决于操作类型：
```
intent_hash = SHA256(canonical_payload)  // payload 包含完整操作细节

// 投递/更新 — 确定性推导，无服务端 nonce；重放保护依赖 challenge 一次性消费
expected_challenge = SHA256("GL-delivery-proof" || uuid || intent_hash)

// 删除 — 包含服务端 nonce（challenge_id + seed）确保新鲜性
expected_challenge = SHA256("GLv2.5" || uuid || challenge_id || intent_hash || seed)

WebAuthn/ECDSA challenge 必须 === expected_challenge
```

## 产品模式（Current Profiles）

### Quick Share（密码）
- 本地生成 ECDSA P-256 管理密钥
- Admin-Priv 用 Argon2id 包裹后编码在管理链接的 URL fragment 中（不存 IndexedDB）
- 任何拥有管理链接和频道密码的人可从任何设备管理频道
- 默认 4KB padding

### Secure Share（Passkey）
- 使用 WebAuthn passkey 管理权
- userVerification = "required"
- residentKey = "discouraged"
- 默认 8KB padding

## 数据流图

```
┌─────────────────────────────────────────────────────────────┐
│                    Sender 视角                               │
├─────────────────────────────────────────────────────────────┤
│  1. 选择 Quick Share 或 Secure Share                        │
│     - Quick: 本地 ECDSA 管理密钥 + Argon2id 包裹            │
│     - Secure: WebAuthn 管理私钥（系统/硬件，不可导出）      │
│  2. 获取 lock_secret（仅用于分享链接 fragment）             │
│  3. 等待 Receiver 上锁                                       │
│  4. 获得 receiver_pub 后：                                   │
│     - 混合加密内容（AES-GCM + RSA-OAEP）                    │
│     - Padding 到 4KB / 8KB 块                               │
│     - Quick: 本地 ECDSA 签名 / Secure: WebAuthn 签名        │
│     - 投递密文到 Server                                      │
│  5. 可随时更新/删除（按所选模式授权）                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Receiver 视角                              │
├─────────────────────────────────────────────────────────────┤
│  1. 从分享链接 fragment 获得 lock_secret                     │
│  2. 输入密码 → 生成 RSA keypair                             │
│  3. 私钥用 Argon2id(密码) 包裹存本地                        │
│  4. 计算 lock_proof 上锁                                     │
│  5. 展示 Safety Code（Emoji/Color）供核对                  │
│  6. Sender 投递后：                                          │
│     - 输入密码 → 解包私钥                                    │
│     - RSA-OAEP 解封 AES key                                  │
│     - AES-GCM 解密并去除 padding                             │
│     - 展示明文                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Server 视角                               │
├─────────────────────────────────────────────────────────────┤
│  - 存储：                                                    │
│    * admin_webauthn 或 admin_pub（发送方管理凭据）          │
│    * lock_key（用于验证 lock_proof，不可逆回 lock_secret）  │
│    * receiver_pub（接收方公钥，仅上锁后存在）               │
│    * cipher_bundle（密文 + 元数据）                         │
│    * version, nonce, challenge（防重放/并发）               │
│  - 能力：                                                    │
│    * 验证 WebAuthn 签名                                      │
│    * 验证 lock_proof                                         │
│    * 原子性更新（DO）                                        │
│    * 时间窗口检查（±120s）                                   │
│  - 不能：                                                    │
│    * 解密内容（无 receiver_priv）                            │
│    * 伪造发送方操作（无 admin_priv）                         │
│    * 知道 lock_secret（只存 lock_key）                       │
└─────────────────────────────────────────────────────────────┘
```

## 状态机

```
┌─────────┐  lock_commit   ┌────────┐  compound_commit  ┌───────────┐
│ Waiting ├───────────────▶│ Locked ├──────────────────▶│ Delivered │
└────┬────┘                └────┬───┘                   └─────┬─────┘
     │                          │                             │
     │        delete_commit     │      delete_commit          │
     └──────────┬───────────────┴──────────────┬──────────────┘
                │                              │
                ▼                              ▼
          ┌─────────┐                    ┌─────────┐
          │ Deleted │                    │ Expired │
          └─────────┘                    └─────────┘
```

**状态转移规则**：
- Waiting → Locked：lock_commit（需 lock_proof）
- Locked → Delivered：compound_commit（首次投递）
- Delivered → Delivered：compound_commit（更新）
- 任意 → Deleted：delete_commit（管理授权：WebAuthn 或 ECDSA）
- 任意 → Expired：TTL 到期

**不可变性**：
- Deleted/Expired 后不可恢复
- version 只能递增
- nonce 不可重用

## 关键常量

```typescript
// 标识符
UUID_LENGTH = 21  // nanoid

// 时间窗口
TIMESTAMP_SKEW_MS = 120000  // ±2min
CHALLENGE_TTL_MS = 60000    // 60s
NONCE_TTL_MS = 600000       // 10min

// 密码学
LOCK_SECRET_BYTES = 32      // lock_secret 长度
LOCK_KEY_BYTES = 32         // lock_key 长度 (SHA256 输出)
CHALLENGE_BYTES = 32        // challenge 长度
NONCE_BYTES = 24            // nonce 长度

// Padding
PAD_BLOCK_DEFAULT = 4096    // 默认 4KB 块
PAD_BLOCK_MAX = 65536       // 最大 64KB 块
MAX_PLAINTEXT_BYTES = 2MB   // 建议上限

// WebAuthn
WEBAUTHN_ALG = -7           // ES256 (ECDSA P-256)
```

## 可验证发布链（当前方案）

### Signed Manifest
- 每次发布生成 manifest.json（文件 hash + 版本 + commit）
- Ed25519 离线签名 → manifest.sig
- 用户可验证前端完整性

### 离线包（计划中，尚未实现）
- 提供 offline.zip（静态文件）
- 可本地打开或自托管

### 自托管（计划中，尚未实现）
- Docker Compose 一键部署
- 协议等价实现（非 Cloudflare Workers）
- 完全自主控制

## 参考资料

- 完整 PRD：[PRD.md](./PRD.zh.md)
- 安全模型：[SECURITY.md](./SECURITY.zh.md)
- API 规范：见 PRD 第 10 节
- 协议图：见 PRD 第 15 节
