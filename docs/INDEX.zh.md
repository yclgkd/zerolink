<!-- synced-with: c6d6bdc -->

> **语言**: [English](./INDEX.md) | 中文

# ZeroLink 文档索引

## 快速查找

### 我想了解...

#### 项目概念
- **项目是什么？** → [README.zh.md](../README.zh.md)
- **如何快速开始？** → [QUICK_START.zh.md](./QUICK_START.zh.md)
- **如何部署到 Cloudflare？** → [DEPLOYMENT.zh.md](./DEPLOYMENT.zh.md)
- **如何本地自部署？** → [SELF_HOSTED_DEPLOYMENT.zh.md](./SELF_HOSTED_DEPLOYMENT.zh.md)
- **核心价值主张** → [PRD.zh.md § 1. 产品概述](./PRD.zh.md#1-产品概述)
- **用户流程** → [PRD.zh.md § 5. 用户流程](./PRD.zh.md#5-用户流程v25-ux-版)

#### 技术架构
- **整体架构** → [ARCHITECTURE.zh.md](./ARCHITECTURE.zh.md)
- **技术栈** → [TECH_STACK.zh.md](./TECH_STACK.zh.md)
- **三方角色模型** → [ARCHITECTURE.zh.md § 三方角色模型](./ARCHITECTURE.zh.md#2-三方角色模型)
- **状态机** → [ARCHITECTURE.zh.md § 状态机](./ARCHITECTURE.zh.md#状态机)

#### 安全设计
- **威胁模型** → [SECURITY.zh.md § 威胁模型](./SECURITY.zh.md#威胁模型)
- **安全目标** → [PRD.zh.md § 2.1 安全目标](./PRD.zh.md#21-安全目标必须满足)
- **攻击场景分析** → [SECURITY.zh.md § 攻击场景分析](./SECURITY.zh.md#攻击场景分析)
- **安全档位** → [PRD.zh.md § 4. 产品模式与安全档位](./PRD.zh.md#4-产品模式与安全档位对外清晰)

#### 核心机制
- **Lock Secret（防 TOFU）** → [ARCHITECTURE.zh.md § TOFU 抢占锁定防护](./ARCHITECTURE.zh.md#1-tofu-抢占锁定防护v25-核心)
- **Padding（防长度泄露）** → [ARCHITECTURE.zh.md § 密文长度泄露缓解](./ARCHITECTURE.zh.md#2-密文长度泄露缓解padding)
- **管理权（WebAuthn / ECDSA）** → [ARCHITECTURE.zh.md § 产品模式](./ARCHITECTURE.zh.md#产品模式current-profiles)
- **Intent Binding** → [ARCHITECTURE.zh.md § Intent Binding](./ARCHITECTURE.zh.md#4-intent-binding意图绑定)

#### 密码学
- **加密方案** → [PRD.zh.md § 7. 密码学与数据格式](./PRD.zh.md#7-密码学与数据格式v25)
- **密码学规范** → [SECURITY.zh.md § 密码学规范](./SECURITY.zh.md#密码学规范)
- **协议常量** → [PRD.zh.md § 附录 A](./PRD.zh.md#附录-a参数表与常量强制)

#### API 协议
- **完整 API 定义** → [PRD.zh.md § 10. API](./PRD.zh.md#10-api-v30-当前)
- **自部署后端契约** → [SELF_HOSTED_CONTRACT.zh.md](./SELF_HOSTED_CONTRACT.zh.md)
- **Lock API** → [PRD.zh.md § 附录 D](./PRD.zh.md#附录-dlock-api-schemav25)
- **协议图（Mermaid）** → [PRD.zh.md § 15. 协议图](./PRD.zh.md#15-协议图mermaid)

#### 实现细节
- **Canonical 规范** → [PRD.zh.md § 附录 B](./PRD.zh.md#附录-bcanonical-ghost-canon-v1-规范与测试向量强制)
- **Lock 精确定义** → [PRD.zh.md § 附录 C](./PRD.zh.md#附录-ctofu-抢占锁定修复lock-secret--lock-key--lock-proof精确定义)
- **Padding 格式** → [PRD.zh.md § 附录 E](./PRD.zh.md#附录-epadding-规范精确字节格式--注意事项)
- **WebAuthn 验证** → [PRD.zh.md § 附录 H](./PRD.zh.md#附录-hwebauthn-验证字节级步骤延续-v24补充对-lockprofile-的约束点)

#### UX 设计
- **Safety Code 规范** → [PRD.zh.md § 附录 K](./PRD.zh.md#附录-k安全码safety-code视觉化规范emoji--color)
- **WebAuthn 不可用引导** → [PRD.zh.md § 13.3](./PRD.zh.md#133-webauthn-不可用时的引导)

#### 测试
- **测试向量** → [PRD.zh.md § 14. 测试向量与验收](./PRD.zh.md#14-测试向量与验收v30)
- **跨运行时自部署 fixture** → [SELF_HOSTED_CONTRACT.zh.md § Fixture 使用规则](./SELF_HOSTED_CONTRACT.zh.md#fixture-使用规则)
- **安全不变量** → [SECURITY.zh.md § 安全不变量](./SECURITY.zh.md#安全不变量implementation)

#### 构建完整性
- **可验证发布流程** → [VERIFY.zh.md](./VERIFY.zh.md)
- **Manifest 签名** → [DEPLOYMENT.zh.md § Manifest 签名](./DEPLOYMENT.zh.md#manifest-签名可选)

---

## 按角色阅读

### 前端开发
1. [QUICK_START.zh.md](./QUICK_START.zh.md) - 初始化项目
2. [TECH_STACK.zh.md](./TECH_STACK.zh.md) - 技术栈概览
3. [ARCHITECTURE.zh.md § 数据流图](./ARCHITECTURE.zh.md#数据流图) - 前端职责
4. [PRD.zh.md § 7](./PRD.zh.md#7-密码学与数据格式v25) - 密码学实现
5. [PRD.zh.md § 附录 C](./PRD.zh.md#附录-ctofu-抢占锁定修复lock-secret--lock-key--lock-proof精确定义) - Lock Secret 实现
6. [PRD.zh.md § 附录 E](./PRD.zh.md#附录-epadding-规范精确字节格式--注意事项) - Padding 实现

### 后端开发
1. [QUICK_START.zh.md](./QUICK_START.zh.md) - 初始化项目
2. [ARCHITECTURE.zh.md](./ARCHITECTURE.zh.md) - 系统架构
3. [SELF_HOSTED_CONTRACT.zh.md](./SELF_HOSTED_CONTRACT.zh.md) - 自部署后端契约
4. [PRD.zh.md § 10](./PRD.zh.md#10-api-v30-当前) - 完整 API
5. [PRD.zh.md § 附录 D](./PRD.zh.md#附录-dlock-api-schemav25) - Lock API Schema
6. [PRD.zh.md § 附录 H](./PRD.zh.md#附录-hwebauthn-验证字节级步骤延续-v24补充对-lockprofile-的约束点) - WebAuthn 验证

### 安全审计
1. [SECURITY.zh.md](./SECURITY.zh.md) - 完整安全模型
2. [SECURITY.zh.md § 攻击场景分析](./SECURITY.zh.md#攻击场景分析) - 威胁分析
3. [SECURITY.zh.md § 安全不变量](./SECURITY.zh.md#安全不变量implementation) - 审计要点
4. [SECURITY.zh.md § 密码学规范](./SECURITY.zh.md#密码学规范) - 加密参数
5. [PRD.zh.md § 14](./PRD.zh.md#14-测试向量与验收v30) - 测试向量

### DevOps / 部署
1. [DEPLOYMENT.zh.md](./DEPLOYMENT.zh.md) - 完整部署指南
2. [SELF_HOSTED_DEPLOYMENT.zh.md](./SELF_HOSTED_DEPLOYMENT.zh.md) - Docker Compose 自部署
3. [VERIFY.zh.md](./VERIFY.zh.md) - 构建完整性验证

---

## 常见问题

### Q: 为什么使用 URL Fragment 存储 lock_secret？
→ [SECURITY.zh.md § TOFU 抢占锁定](./SECURITY.zh.md#3-tofu-抢占锁定)

### Q: Padding 如何防止长度泄露？
→ [ARCHITECTURE.zh.md § 密文长度泄露缓解](./ARCHITECTURE.zh.md#2-密文长度泄露缓解padding)

### Q: WebAuthn 私钥能被导出吗？
→ [SECURITY.zh.md § 管理权私钥不可导出](./SECURITY.zh.md#7-管理权私钥不可导出-secure-share)

### Q: 服务器能看到明文吗？
→ [SECURITY.zh.md § 服务器零知识](./SECURITY.zh.md#1-服务器零知识-)

### Q: 如何防止中间人攻击？
→ [SECURITY.zh.md § 中间人攻击](./SECURITY.zh.md#4-中间人攻击mitm)

### Q: Quick Share 和 Secure Share 有什么区别？
→ [PRD.zh.md § 4. 产品模式与安全档位](./PRD.zh.md#4-产品模式与安全档位对外清晰)

### Q: 如何验证前端代码未被篡改？
→ [VERIFY.zh.md](./VERIFY.zh.md)
