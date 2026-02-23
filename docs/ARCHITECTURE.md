# ZeroLink 架构概览

## 核心架构原则

### 1. 零知识架构
- **服务器不存明文**：所有内容在客户端加密，服务器只存储密文
- **服务器不存私钥**：接收方私钥在客户端生成并本地存储（Argon2id 包裹）
- **管理权不可导出**：发送方管理权使用 WebAuthn（私钥驻留系统/硬件）

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
- **平台**：Cloudflare Workers + Durable Objects + KV
- **状态管理**：Durable Objects（串行化、原子性）
- **持久化**：KV（密文、公钥、元数据）
- **自托管选项**：Docker Compose（PostgreSQL/SQLite + Redis）

## 核心协议流程

### 1. Create（创建）
```
Sender → WebAuthn 注册 → 生成 lock_secret
     → 返回两条链接：
       - /s/:uuid#k=<lock_secret>  （分享链接，含 fragment）
       - /m/:uuid                   （管理链接）
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
      → WebAuthn 签名确认
      → compound_commit 写入密文（原子性）
```

### 4. Update/Delete（管理）
```
Sender → WebAuthn 签名授权
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

**解决方案**：
```
intent_hash = SHA256(canonical_payload)  // payload 包含完整操作细节
expected_challenge = SHA256("GLv2.5" || uuid || challenge_id || intent_hash || seed)
WebAuthn challenge 必须 === expected_challenge
```

## 安全档位（Security Profiles）

### Standard（默认）
- 允许平台 passkey（可能同步到云）
- userVerification = "preferred"
- 适合大多数用户

### Strict（严格）
- userVerification = "required"
- 尽量避免可备份凭据（检测 backupEligibility）
- 每次操作强制确认

### Hardware-Only（极限）
- authenticatorAttachment = "cross-platform"（硬件钥匙）
- attestation = "direct"（可验证硬件属性）
- 无法满足则阻断

## 兼容模式（Fallback）

当 WebAuthn 不可用时（仅 Standard 档位）：
- 改用 ECDSA P-256 软件密钥
- Admin-Priv 用 Argon2id 包裹存 IndexedDB
- UI 显著标注"兼容模式（较低安全）"

## 数据流图

```
┌─────────────────────────────────────────────────────────────┐
│                    Sender 视角                               │
├─────────────────────────────────────────────────────────────┤
│  1. WebAuthn 注册 → 管理私钥（系统/硬件，不可导出）          │
│  2. 获取 lock_secret（仅用于分享链接 fragment）             │
│  3. 等待 Receiver 上锁                                       │
│  4. 获得 receiver_pub 后：                                   │
│     - 混合加密内容（AES-GCM + RSA-OAEP）                    │
│     - Padding 到 4KB 块                                      │
│     - WebAuthn 签名确认                                      │
│     - 投递密文到 Server                                      │
│  5. 可随时更新/删除（WebAuthn 授权）                        │
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
│    * admin_webauthn（发送方公钥 + credential）              │
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
- 任意 → Deleted：delete_commit（WebAuthn 授权）
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

## 可验证发布链（未来）

### Signed Manifest
- 每次发布生成 manifest.json（文件 hash + 版本 + commit）
- Ed25519 离线签名 → manifest.sig
- 用户可验证前端完整性

### 离线包
- 提供 offline.zip（静态文件）
- 可本地打开或自托管

### 自托管
- Docker Compose 一键部署
- 协议等价实现（非 Cloudflare Workers）
- 完全自主控制

## 参考资料

- 完整 PRD：[PRD-v2.5.md](./PRD-v2.5.md)
- 安全模型：[SECURITY.md](./SECURITY.md)
- API 规范：见 PRD 第 10 节
- 协议图：见 PRD 第 15 节
