# 自部署后端契约冻结

这份文档用于冻结自部署后端在开始 Go 实现前必须复现的协议外观契约。

## 范围

- 枚举前端当前依赖的 HTTP / WebSocket 契约
- 冻结必须逐字节一致的输出面
- 记录对前端可见的错误语义
- 明确列出当前不能靠“实现时猜测”解决的开放问题

## 必须精确复现的输出面

| 输出面 | 当前 TS 位置 | 为什么必须一致 | fixture 覆盖 |
| --- | --- | --- | --- |
| Canonical JSON 排序 | `packages/shared/src/canonical.ts` | `intentHash` 跨运行时必须一致 | `canonicalJson` |
| `intentHash = SHA-256(canonicalJson)` | `packages/shared/src/canonical.ts` | WebAuthn / softkey proof 都绑定它 | `canonicalJson` |
| Cipher bundle AAD 字符串与 UTF-8 bytes | `packages/shared/src/protocol.ts` | 接收方解密完整性依赖相同 AAD | `aad` |
| `lock_key = SHA-256("GL-lockkey" || uuid || lock_secret)` | `packages/frontend/src/crypto/protocol-utils.ts` | lock proof 校验依赖它 | `challengeDerivation.lock` |
| `lock_proof = SHA-256("GL-lock" || uuid || challenge_id || challenge || lock_key)` | `packages/frontend/src/crypto/protocol-utils.ts` | TOFU 防抢锁核心 | `challengeDerivation.lock` |
| `expectedCompoundChallenge = SHA-256("GLv2.5" || uuid || challenge_id || intent_hash || seed)` | `packages/frontend/src/crypto/protocol-utils.ts` | WebAuthn challenge 绑定操作意图 | `challengeDerivation.compound` |
| `deliveryProofChallenge = SHA-256("GL-delivery-proof" || uuid || intent_hash)` | `packages/shared/src/senderAuth.ts` | detached delivery proof 校验依赖它 | `challengeDerivation.deliveryProof` |
| WebSocket 消息 schema | `packages/shared/src/ws.ts` | 实时同步兼容性 | `ws` |

冻结用的 JSON fixture 位于 `protocol-fixtures/selfhost-contract-v1.json`。

## HTTP 契约矩阵

| 路由 | 方法 | 请求 schema | 成功 schema | 当前前端调用点 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `/api/create_begin/:uuid` | `POST` | `CreateBeginRequestSchema` | `CreateBeginResponseSchema` | `apiClient.createBegin()` | 当前始终返回 `creationOptions`；password 模式兼容行为先冻结 |
| `/api/create_finish/:uuid` | `POST` | `CreateFinishRequestSchema` | `CreateFinishResponseSchema` | `apiClient.createFinish()` | 接受 `webauthn`、`password`、legacy `softkey` |
| `/api/lock_begin/:uuid` | `POST` | `LockBeginRequestSchema` | `LockBeginResponseSchema` | `apiClient.lockBegin()` | 接收方上锁 begin |
| `/api/lock_commit/:uuid` | `POST` | `LockCommitRequestSchema` | `LockCommitResponseSchema` | `apiClient.lockCommit()` | 当前后端可能在响应头里设置 commit-cookie |
| `/api/manage/compound_begin/:uuid` | `POST` | `CompoundBeginRequestSchema` | `CompoundBeginResponseSchema` | `apiClient.compoundBegin()` | 返回 admin mode、security profile、version，以及可选 receiver 身份 |
| `/api/manage/compound_commit/:uuid` | `POST` | `CompoundCommitRequestSchema` 或 `SoftkeyCompoundCommitRequestSchema` | `CompoundCommitResponseSchema` | `apiClient.compoundCommit()` | update / deliver 主路径 |
| `/api/delete_commit/:uuid` | `POST` | 同 commit union，但 `intent.op = delete` | `{ ok: true }` | `apiClient.deleteCommit()` | delete-only alias |
| `/api/public/:uuid` | `GET` | 无 | `PublicStatusResponseSchema` | `apiClient.publicStatus()` 与 polling fallback | 只返回公开状态快照 |
| `/api/decrypt_fetch/:uuid` | `GET` | 无 | `DecryptFetchResponseSchema` | `apiClient.decryptFetch()` | 交付后返回解密载荷 |
| `/api/ws/:uuid` | `GET` + WebSocket upgrade | 升级后走 `WsClientMessageSchema` | `WsServerMessageSchema` | `ChannelSync.connect()` | 当前未带 `Upgrade: websocket` 会返回 `426` + `{ ok: false, code: "BAD_REQUEST" }` |

## 错误语义矩阵

| Code | HTTP 状态 | 当前来源 | 含义 |
| --- | --- | --- | --- |
| `BAD_REQUEST` | `400` | Worker 边缘校验 | JSON 非法、schema 不匹配、UUID 非法、path/body UUID 不一致 |
| `BAD_REQUEST` | `426` | Worker WS upgrade gate | 命中 `/api/ws/:uuid` 但没有 WebSocket 升级头 |
| `METHOD_NOT_ALLOWED` | `405` | Worker router | HTTP 方法不对；会带 `Allow` 头 |
| `NOT_FOUND` | `404` | Worker router 或 DO | 路由不存在、channel 不存在、或终态已 finalize |
| `NOT_IMPLEMENTED` | `501` | Worker router | 命中占位路由但未实现 |
| `INTERNAL_ERROR` | `500` | Worker 或 DO | 未预期异常或上游响应无效 |
| `RATE_LIMITED` | `429` | DO | 应用层限流；可能带 `Retry-After` |
| `CHALLENGE_INVALID` | `401` | DO | challenge 缺失、过期或无效 |
| `CHALLENGE_CONSUMED` | `409` | DO | challenge 已被消费 |
| `LOCK_FORBIDDEN` | `403` | DO | 非法状态迁移、终态、或 lock 不允许 |
| `VERSION_MISMATCH` | `409` | DO | update/delete 版本过旧或乱序 |
| `NONCE_REPLAY` | `409` | DO | nonce 已消费 |
| `TIMESTAMP_OUT_OF_RANGE` | `400` | DO | 时间戳超出允许窗口 |
| `INTENT_HASH_MISMATCH` | `400` | DO | 声明的 `intentHash` 与实际 payload 不一致 |
| `CIPHER_BUNDLE_INVALID` | `400` | DO | cipher bundle 结构或完整性被拒绝 |
| `ASSERTION_INVALID` | `403` | DO | WebAuthn 或 softkey 签名校验失败 |
| `ATTESTATION_UNVERIFIABLE` | `403` | DO | create 阶段 attestation 校验失败 |

## WebSocket 兼容要求

- 客户端消息必须通过 `WsClientMessageSchema`
- 服务端消息必须通过 `WsServerMessageSchema`
- 前端策略是“优先 WS，失败后 polling”
- 顺序要求是语义级别的：前端只接受 `version >= lastVersion`

## 当前明确保留的开放问题

1. commit-cookie 绑定目前是纯后端安全机制。前端不读取它，但自部署版在 M4 / M5 之前必须提供等价的 begin/commit caller 绑定能力。
2. `create_begin` 现在总是返回 `creationOptions`，即使 password 模式不以同样方式消费 WebAuthn。除非单独改前端契约，否则先保持现状。
3. rate-limit 的桶大小和窗口目前不属于 shared schema 契约。自部署版先复现 code/status 语义，再单独文档化策略。
4. 只有在 `/api/ws/:uuid` 语义和当前 polling fallback 都保持兼容的前提下，才能替换底层实时传输。

## Fixture 使用规则

- 新 fixture 统一追加到 `protocol-fixtures/selfhost-contract-v1.json`
- 不要把协议常量散落到多个测试文件里
- fixture 变更按契约变更处理：文档、JSON、测试必须一起更新
