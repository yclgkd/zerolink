<!-- synced-with: 0957905 -->

# 自部署后端契约冻结

这份文档用于冻结自部署后端当前对外复现的协议契约。

## 范围

- 枚举前端当前依赖的 HTTP / WebSocket 契约
- 冻结必须逐字节一致的输出面
- 记录对前端可见的错误语义
- 明确列出当前不能靠”实现时猜测”解决的开放问题
- 覆盖前端现在依赖的文件策略与 multipart 文件传输叠加层

## 必须精确复现的输出面

| 输出面 | 当前 TS 位置 | 为什么必须一致 | fixture 覆盖 |
| --- | --- | --- | --- |
| Canonical JSON 排序 | `packages/shared/src/canonical.ts` | `intentHash` 跨运行时必须一致 | `canonicalJson` |
| `intentHash = SHA-256(canonicalJson)` | `packages/shared/src/canonical.ts` | WebAuthn / softkey proof 都绑定它 | `canonicalJson` |
| Cipher bundle AAD 字符串与 UTF-8 bytes | `packages/shared/src/protocol.ts` | 接收方解密完整性依赖相同 AAD | `aad` |
| `lock_key = SHA-256(“GL-lockkey” || uuid || lock_secret)` | `packages/frontend/src/crypto/protocol-utils.ts` | lock proof 校验依赖它 | `challengeDerivation.lock` |
| `lock_proof = SHA-256(“GL-lock” || uuid || challenge_id || challenge || lock_key)` | `packages/frontend/src/crypto/protocol-utils.ts` | TOFU 防抢锁核心 | `challengeDerivation.lock` |
| `expectedCompoundChallenge = SHA-256(“GLv2.5” || uuid || challenge_id || intent_hash || seed)` | `packages/frontend/src/crypto/protocol-utils.ts` | WebAuthn challenge 绑定操作意图 | `challengeDerivation.compound` |
| `deliveryProofChallenge = SHA-256(“GL-delivery-proof” || uuid || intent_hash)` | `packages/shared/src/senderAuth.ts` | detached delivery proof 校验依赖它 | `challengeDerivation.deliveryProof` |
| Multipart chunk IV/AAD 推导（`baseIv XOR chunkIndex`，AAD = `uuid || "chunk" || be32(index)`） | `packages/shared/src/multipart.ts` | 大文件解密完整性与防重排 | — |
| WebSocket 消息 schema | `packages/shared/src/ws.ts` | 实时同步兼容性 | `ws` |

冻结用的 JSON fixture 位于 `protocol-fixtures/selfhost-contract-v1.json`。

### 输入编码规则

所有 hash 推导遵循同一模式：每个输入独立编码为字节切片，按顺序拼接后送入 SHA-256。

| 参数类型 | 编码方式 | 示例 |
| --- | --- | --- |
| 域前缀字符串 | UTF-8 → bytes | `”GL-lockkey”`, `”GL-lock”`, `”GLv2.5”`, `”GL-delivery-proof”` |
| UUID | UTF-8 → bytes（字符串原样，不做解码） | 所有推导中的 `uuid` |
| Base64url 编码的输入 | **base64url decode → 原始字节** | `lock_secret`, `challenge_id`, `challenge`, `lock_key`, `seed` |
| Intent hash（hex 字符串） | **UTF-8 → bytes（64 字符 hex 字符串原样保留，不做 hex decode）** | compound challenge 和 delivery proof 中的 `intentHash` |

各函数的输出编码：

| 函数 | 输出编码 |
| --- | --- |
| `lock_key` | base64url |
| `lock_proof` | 小写 hex（64 字符） |
| `expectedCompoundChallenge` | base64url |
| `deliveryProofChallenge` | base64url |
| `intentHash` | 小写 hex（64 字符） |

### Canonical JSON 规则

`canonicalJsonStringify` 执行**递归**字母序 key 排序：

- 所有嵌套层级的 object key 均按字典序排列（JavaScript `Array.sort()` 默认行为）
- 数组元素顺序不变；只对数组内的 object key 排序
- `undefined` 值从输出中省略（整个 key 被丢弃）
- `null` 在 JSON 输出中保留为 `null`
- 排序后通过 `JSON.stringify` 序列化（标准 JSON 编码）

## HTTP 契约矩阵

| 路由 | 方法 | 请求 schema | 成功 schema | 当前前端调用点 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `/api/create_begin/:uuid` | `POST` | `CreateBeginRequestSchema` | `CreateBeginResponseSchema` | `apiClient.createBegin()` | 当前始终返回 `creationOptions`；password 模式兼容行为先冻结 |
| `/api/create_finish/:uuid` | `POST` | `CreateFinishRequestSchema` | `CreateFinishResponseSchema` | `apiClient.createFinish()` | 接受 `webauthn`、`password`、legacy `softkey` 这三种 schema 变体；但 `secure` channel 必须以 `webauthn` 完成，`quick` 才允许三者任选 |
| `/api/lock_begin/:uuid` | `POST` | `LockBeginRequestSchema` | `LockBeginResponseSchema` | `apiClient.lockBegin()` | 接收方上锁 begin；响应头可能设置用于 caller binding 的 commit-cookie 状态 |
| `/api/lock_commit/:uuid` | `POST` | `LockCommitRequestSchema` | `LockCommitResponseSchema` | `apiClient.lockCommit()` | 消费当前 lock challenge；响应头可能清理或轮转 commit-cookie 状态 |
| `/api/manage/compound_begin/:uuid` | `POST` | `CompoundBeginRequestSchema` | `CompoundBeginResponseSchema` | `apiClient.compoundBegin()` | 返回 admin mode、security profile、version，以及可选 receiver 身份；响应头可能设置用于 caller binding 的 commit-cookie 状态 |
| `/api/manage/compound_commit/:uuid` | `POST` | `CompoundCommitRequestSchema` 或 `SoftkeyCompoundCommitRequestSchema` | `CompoundCommitResponseSchema` | `apiClient.compoundCommit()` | update / deliver 主路径；响应头可能清理或轮转 commit-cookie 状态 |
| `/api/delete_commit/:uuid` | `POST` | 同 commit union，但 `intent.op = delete` | `{ ok: true }` | `apiClient.deleteCommit()` | compound commit 的 delete-only alias；继承相同的 commit-cookie caller-binding 语义 |
| `/api/public/:uuid` | `GET` | 无 | `PublicStatusResponseSchema` | `apiClient.publicStatus()` 与 polling fallback | 只返回活跃 channel 的公开状态；一旦 channel 已 tombstone 化或被 lazy purge，规范外部行为是 `404 NOT_FOUND`，而不是 `200` 终态快照 |
| `/api/decrypt_fetch/:uuid` | `GET` | 无 | `DecryptFetchResponseSchema` | `apiClient.decryptFetch()` | 交付后返回解密载荷；响应里会且只会出现 `cipherBundle` 或 `fileRef` 其中之一，`cipherVersion` 表示本次已交付密文的版本（当前 DO 实现里等于 `record.version - 1`），不是原始 channel record 的 `version` |
| `/api/file_policy` | `GET` | 无 | `FilePolicyResponseSchema` | `apiClient.filePolicy()` | 返回部署侧文件上限、legacy inline 阈值、chunk 参数和 multipart 能力；前端据此判断文件上传是否可用，并配置 chunk 参数 |
| `/api/file/initiate` | `POST` | `FileUploadInitiateRequestSchema` | `FileUploadInitiateResponseSchema` | `apiClient.fileUploadInitiate()` | 当 `S3_PUBLIC_ENDPOINT` 已设置时返回 S3 预签名 PUT URL；未设置时返回 `/api/file/chunk/` 代理路径，Go API 代替浏览器流式转发 chunk 字节 |
| `/api/file/complete` | `POST` | `FileUploadCompleteRequestSchema` | `FileUploadCompleteResponseSchema` | `apiClient.fileUploadComplete()` | 校验已上传 chunk 的元数据，并返回后续写入 `compound_commit` 的 `fileRef` |
| `/api/file/fetch/:uuid` | `GET` | 无 | `FileFetchResponseSchema` | `apiClient.fileFetch()` | 对已交付的 multipart payload 返回每个 chunk 的下载 URL（`S3_PUBLIC_ENDPOINT` 已设置时为预签名 S3 URL，未设置时为 `/api/file/download/` 代理路径）；inline payload 仍只走 `decrypt_fetch` |
| `/api/ws/:uuid` | `GET` + WebSocket upgrade | 升级后走 `WsClientMessageSchema` | `WsServerMessageSchema` | `ChannelSync.connect()` | 当前未带 `Upgrade: websocket` 会返回 `426` + `{ ok: false, code: "BAD_REQUEST" }` |

当 `SELFHOST_API_S3_PUBLIC_ENDPOINT` 已设置（浏览器能直达外部 S3）时，chunk 字节直接走
`/api/file/initiate` 和 `/api/file/fetch/:uuid` 返回的 S3 预签名 URL。当未设置（如 Docker
内置 Garage）时，Go API 暴露 `/api/file/chunk/{uploadId}/{index}`（PUT）和
`/api/file/download/{key...}`（GET）代理路由，替浏览器流式转发 chunk 字节。

### Multipart 传输叠加层

- 所有新的 `payloadKind: "file"` 交付都走对象存储 `fileRef`；只有文本载荷走 inline `cipherBundle`。`/api/file_policy` 中的 `multipartThresholdBytes` 保留用于 legacy 兼容，不再影响新的文件写入路径。
- update intent 必须在 `cipherBundle` 与 `fileRef` 之间二选一；multipart 交付还要求 `payloadKind: "file"`。
- `/api/decrypt_fetch/:uuid` 仍是交付元数据的权威来源，并且只会返回 `cipherBundle` 或 `fileRef` 二者之一。
- 只有当 `decrypt_fetch` 暴露出 multipart `fileRef` 时，`/api/file/fetch/:uuid` 才有意义。

## 错误语义矩阵

| Code | HTTP 状态 | 当前来源 | 含义 |
| --- | --- | --- | --- |
| `BAD_REQUEST` | `400` | Worker 边缘校验 | JSON 非法、schema 不匹配、UUID 非法、path/body UUID 不一致 |
| `BAD_REQUEST` | `426` | Worker WS upgrade gate | 命中 `/api/ws/:uuid` 但没有 WebSocket 升级头 |
| `METHOD_NOT_ALLOWED` | `405` | Worker router | HTTP 方法不对；会带 `Allow` 头 |
| `NOT_FOUND` | `404` | Worker router 或 DO | 路由不存在、channel 不存在、终态已 finalize，或 `/api/file/fetch/:uuid` 当前没有 multipart 文件载荷 |
| `BAD_REQUEST` | `400` | 文件协调路由 / S3 元数据校验 | 文件策略输入非法、multipart 元数据格式错误、chunk 缺失，或 S3 预签名/Stat 校验失败 |
| `NOT_IMPLEMENTED` | `501` | Worker router | 命中占位路由但未实现 |
| `INTERNAL_ERROR` | `500` | Worker 或 DO | 未预期异常或上游响应无效 |
| `RATE_LIMITED` | `429` | DO | 应用层限流；可能带 `Retry-After` |
| `CHANNEL_NOT_DELIVERED` | `409` | DO decrypt-fetch 读路径 | channel 存在，但当前还没有可供解密的密文 |
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

## Channel 状态机

后端必须精确执行以下状态迁移。未列出的迁移必须以 `LOCK_FORBIDDEN` 拒绝。

| 起始 | 目标 | 触发 | 说明 |
| --- | --- | --- | --- |
| `waiting` | `locked` | `lock_commit` | 需要有效的 `lock_proof` |
| `locked` | `delivered` | `compound_commit` | 首次交付；需 cipher bundle |
| `delivered` | `delivered` | `compound_commit` | 更新交付；version 必须递增 |
| `waiting`, `locked`, `delivered` | `deleted` | `delete_commit` | 需有效 sender auth（WebAuthn 或 softkey） |
| 任何非终态 | `expired` | TTL 到期 | 自动触发，无 API 入口 |

终态（`deleted`、`expired`）不允许任何后续迁移。一旦终态被 finalize 成 tombstone，或过期记录被 lazy purge，后续外部请求的规范行为就是返回 `NOT_FOUND`。`LOCK_FORBIDDEN` 仍用于活跃非终态记录上的非法迁移。

合法状态：`waiting`、`locked`、`delivered`、`deleted`、`expired`。

合法 admin mode：`webauthn`、`password`、`softkey`（`password` 的 legacy 别名；凡接受 `password` 的地方必须同时接受 `softkey`）。

合法 security profile：`quick`、`secure`。

Admin-mode 绑定不变量：`secure` channel 在 `create_finish` 必须使用 `webauthn`；`quick` channel 可以使用 `webauthn`、`password` 或 `softkey`。

## WebSocket 兼容要求

- 客户端消息必须通过 `WsClientMessageSchema`
- 服务端消息必须通过 `WsServerMessageSchema`
- 前端策略是”优先 WS，失败后 polling”
- 顺序要求是语义级别的：前端只接受 `version >= lastVersion`
- 服务端消息类型：`state_changed`、`channel_closed`（reason：`deleted` | `expired`）、`pong`
- 客户端消息类型：`subscribe`、`ping`

### Polling Fallback

当 WebSocket 断连时，前端回退到每 18 秒轮询 `/api/public/:uuid`（`POLL_INTERVAL_MS`）。这条路径与 WebSocket `state_changed` 是“兼容等价”，但不是逐字节一致：响应仍然使用 `PublicStatusResponseSchema`，而它本身不带 `version`，前端会在把 polling 结果转换成 `ChannelStateUpdate` 时复用本地 `lastVersion`。对于不存在、已删除、已过期的 channel，规范外部行为是 `404 NOT_FOUND`；前端仍兼容历史上的 `200` 终态快照，但 Go 后端应以 tombstone 驱动的 `404` 语义为目标。

## 当前明确保留的开放问题

1. commit-cookie 绑定目前是纯后端安全机制。前端不读取它，但自部署版在 M4 / M5 之前必须提供等价的 begin/commit caller 绑定能力。
2. `create_begin` 现在总是返回 `creationOptions`，即使 password 模式不以同样方式消费 WebAuthn。除非单独改前端契约，否则先保持现状。
3. rate-limit 的桶大小和窗口目前不属于 shared schema 契约。自部署版先复现 code/status 语义，再单独文档化策略。
4. 只有在 `/api/ws/:uuid` 语义和当前 polling fallback 都保持兼容的前提下，才能替换底层实时传输。

## Fixture 使用规则

- 新 fixture 统一追加到 `protocol-fixtures/selfhost-contract-v1.json`
- 不要把协议常量散落到多个测试文件里
- fixture 变更按契约变更处理：文档、JSON、测试必须一起更新
