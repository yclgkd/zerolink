<!-- synced-with: 8d64659 -->

> **语言**: [English](./INDEX.md) | 中文

# ZeroLink 文档索引

> 快速定位：AI 助手和开发者的导航指南

## 文档结构

```
docs/
├── INDEX.md           # 本文件 - 快速索引
├── QUICK_START.md    # 快速启动指南（从零到运行）
├── DEPLOYMENT.md     # 部署指南（Cloudflare 一键部署 + 手动部署）
├── TECH_STACK.md     # 技术栈规范（工具链、Monorepo、测试）
├── PRD.md       # 完整产品需求文档（主文档）
├── ARCHITECTURE.md   # 架构概览
└── SECURITY.md       # 安全模型
```

---

## 快速查找

### 我想了解...

#### 项目概念
- **项目是什么？** → [README.md](../README.zh.md)
- **如何快速开始？** → [QUICK_START.md](./QUICK_START.zh.md)
- **如何部署到 Cloudflare？** → [DEPLOYMENT.md](./DEPLOYMENT.zh.md)
- **核心价值主张** → [PRD.md § 1. 产品概述](./PRD.zh.md#1-产品概述)
- **用户流程** → [PRD.md § 5. 用户流程](./PRD.zh.md#5-用户流程v25-ux-版)

#### 技术架构
- **整体架构** → [ARCHITECTURE.md](./ARCHITECTURE.zh.md)
- **技术栈规范** → [TECH_STACK.md](./TECH_STACK.zh.md)
- **Monorepo 结构** → [TECH_STACK.md § Monorepo 结构](./TECH_STACK.zh.md#monorepo-结构)
- **三方角色模型** → [ARCHITECTURE.md § 三方角色模型](./ARCHITECTURE.zh.md#2-三方角色模型)
- **状态机** → [ARCHITECTURE.md § 状态机](./ARCHITECTURE.zh.md#状态机)

#### 安全设计
- **威胁模型** → [SECURITY.md § 威胁模型](./SECURITY.zh.md#威胁模型)
- **安全目标** → [PRD.md § 2.1 安全目标](./PRD.zh.md#21-安全目标必须满足)
- **攻击场景分析** → [SECURITY.md § 攻击场景分析](./SECURITY.zh.md#攻击场景分析)
- **安全档位** → [PRD.md § 4. 产品模式与安全档位](./PRD.zh.md#4-产品模式与安全档位对外清晰)

#### 核心机制
- **Lock Secret（防 TOFU）** → [ARCHITECTURE.md § TOFU 抢占锁定防护](./ARCHITECTURE.zh.md#1-tofu-抢占锁定防护v25-核心)
- **Padding（防长度泄露）** → [ARCHITECTURE.md § 密文长度泄露缓解](./ARCHITECTURE.zh.md#2-密文长度泄露缓解padding)
- **WebAuthn 管理权** → [ARCHITECTURE.md § 并发安全](./ARCHITECTURE.zh.md#3-并发安全durable-objects)
- **Intent Binding** → [ARCHITECTURE.md § Intent Binding](./ARCHITECTURE.zh.md#4-intent-binding意图绑定)

#### 密码学
- **加密方案** → [PRD.md § 7. 密码学与数据格式](./PRD.zh.md#7-密码学与数据格式v25)
- **密码学规范** → [SECURITY.md § 密码学规范](./SECURITY.zh.md#密码学规范)
- **协议常量** → [PRD.md § 附录 A](./PRD.zh.md#附录-a参数表与常量强制)

#### API 协议
- **完整 API 定义** → [PRD.md § 10. API](./PRD.zh.md)
- **Lock API** → [PRD.md § 附录 D](./PRD.zh.md#附录-dlock-api-schemav25)
- **协议图（Mermaid）** → [PRD.md § 15. 协议图](./PRD.zh.md#15-协议图mermaid)

#### 实现细节
- **Canonical 规范** → [PRD.md § 附录 B](./PRD.zh.md#附录-bcanonical-ghost-canon-v1-规范与测试向量强制)
- **Lock 精确定义** → [PRD.md § 附录 C](./PRD.zh.md#附录-ctofu-抢占锁定修复lock-secret--lock-key--lock-proof精确定义)
- **Padding 格式** → [PRD.md § 附录 E](./PRD.zh.md#附录-epadding-规范精确字节格式--注意事项)
- **WebAuthn 验证** → [PRD.md § 附录 H](./PRD.zh.md#附录-hwebauthn-验证字节级步骤延续-v24补充对-lockprofile-的约束点)

#### UX 设计
- **指纹核对柔化** → [PRD.md § 13.1](./PRD.zh.md#131-指纹核对的柔化呈现)
- **Safety Code 规范** → [PRD.md § 附录 K](./PRD.zh.md#附录-k安全码safety-code视觉化规范emoji--color)
- **WebAuthn 不可用引导** → [PRD.md § 13.3](./PRD.zh.md)

#### 测试
- **测试向量** → [PRD.md § 14. 测试向量与验收](./PRD.zh.md)
- **安全检查清单** → [SECURITY.md § 安全检查清单](./SECURITY.zh.md#安全检查清单implementation)

---

## 按角色阅读

### 产品经理
1. [README.md](../README.zh.md) - 项目概览
2. [PRD.md § 1-5](./PRD.zh.md) - 产品定义、流程、UX
3. [PRD.md § 4](./PRD.zh.md#4-产品模式与安全档位对外清晰) - 安全档位
4. [PRD.md § 13](./PRD.zh.md#13-uiux-规范落实产品经理建议) - UI/UX 规范

### 前端开发
1. [QUICK_START.md](./QUICK_START.zh.md) - 初始化项目
2. [TECH_STACK.md](./TECH_STACK.zh.md) - 完整技术栈规范
3. [ARCHITECTURE.md § 数据流图](./ARCHITECTURE.zh.md#数据流图) - 前端职责
4. [PRD.md § 7](./PRD.zh.md#7-密码学与数据格式v25) - 密码学实现
5. [PRD.md § 附录 C](./PRD.zh.md#附录-ctofu-抢占锁定修复lock-secret--lock-key--lock-proof精确定义) - Lock Secret 实现
6. [PRD.md § 附录 E](./PRD.zh.md#附录-epadding-规范精确字节格式--注意事项) - Padding 实现

### 后端开发
1. [QUICK_START.md](./QUICK_START.zh.md) - 初始化项目
2. [TECH_STACK.md § 后端部署](./TECH_STACK.zh.md#部署与发布) - Cloudflare Workers 配置
3. [ARCHITECTURE.md § 技术栈](./ARCHITECTURE.zh.md#3-技术栈) - 后端架构
4. [PRD.md § 10](./PRD.zh.md) - 完整 API
5. [PRD.md § 附录 D](./PRD.zh.md#附录-dlock-api-schemav25) - Lock API Schema
6. [PRD.md § 附录 H](./PRD.zh.md#附录-hwebauthn-验证字节级步骤延续-v24补充对-lockprofile-的约束点) - WebAuthn 验证

### 安全审计
1. [SECURITY.md](./SECURITY.zh.md) - 完整安全模型
2. [SECURITY.md § 攻击场景分析](./SECURITY.zh.md#攻击场景分析) - 威胁分析
3. [SECURITY.md § 安全检查清单](./SECURITY.zh.md#安全检查清单implementation) - 审计要点
4. [PRD.md § 14](./PRD.zh.md#14-测试向量与验收v25-新增) - 测试向量
5. [SECURITY.md § 密码学规范](./SECURITY.zh.md#密码学规范) - 加密参数

### DevOps / 部署
1. [DEPLOYMENT.md](./DEPLOYMENT.zh.md) - **完整部署指南（一键部署 + 手动部署）**
2. [DEPLOYMENT.md](./DEPLOYMENT.zh.md) - GitHub Actions 与发布流程
3. [TECH_STACK.md § 部署与发布](./TECH_STACK.zh.md#部署与发布) - 前后端部署
4. [TECH_STACK.md § 发布流程](./TECH_STACK.zh.md#版本管理与发布流水线) - PR 验证与 tag 发布
5. [DEPLOYMENT.md](./DEPLOYMENT.zh.md) - 域名与 Cloudflare 配置

---

## 版本历史

### v3.0（当前）
- **核心改进**：Lock Secret（URL Fragment）+ Padding + Argon2id 强制
- **新增**：Quick Share（密码）/ Secure Share（Passkey）双模式创建
- **新增**：可验证发布链设计
- **完善**：新建与发送者管理主流程统一到 Quick Share / Secure Share；legacy 档位仅用于向后兼容

### v2.4（前代）
- WebAuthn 管理权 + DO 原子性 + Intent Binding

### v2.3（更早）
- ECDSA 软件密钥管理

---

## 常见问题快速定位

### Q: 为什么使用 URL Fragment 存储 lock_secret？
→ [SECURITY.md § TOFU 抢占锁定](./SECURITY.zh.md#3-tofu-抢占锁定)

### Q: Padding 如何防止长度泄露？
→ [ARCHITECTURE.md § 密文长度泄露缓解](./ARCHITECTURE.zh.md#2-密文长度泄露缓解padding)

### Q: WebAuthn 私钥能被导出吗？
→ [SECURITY.md § 管理权私钥不可导出](./SECURITY.zh.md#7-管理权私钥不可导出-)

### Q: 服务器能看到明文吗？
→ [SECURITY.md § 服务器零知识](./SECURITY.zh.md#1-服务器零知识-)

### Q: 如何防止中间人攻击？
→ [SECURITY.md § 中间人攻击](./SECURITY.zh.md#4-中间人攻击mitm)

### Q: Argon2id 参数如何选择？
→ [SECURITY.md § 密码学规范 § KDF](./SECURITY.zh.md#密码学规范)

### Q: 如何验证前端代码未被篡改？
→ [PRD.md § 12. 前端完整性](./PRD.zh.md#12-前端完整性与可验证发布链解决恶意下发-js-的上限方案)

### Q: Quick Share 和 Secure Share 有什么区别？
→ [PRD.md § 4. 产品模式与安全档位](./PRD.zh.md#4-产品模式与安全档位对外清晰)

### Q: legacy 档位和旧 softkey 频道怎么处理？
→ [PRD.md § 4. 产品模式与安全档位](./PRD.zh.md#4-产品模式与安全档位对外清晰)

### Q: 如何初始化 Monorepo？
→ [QUICK_START.md](./QUICK_START.zh.md)

### Q: 为什么选择 pnpm Monorepo？
→ [TECH_STACK.md § 设计原则](./TECH_STACK.zh.md#设计原则)

### Q: 测试体系如何设计？
→ [TECH_STACK.md § 测试体系](./TECH_STACK.zh.md#测试体系)

---

## AI 助手使用指南

### 当被问到"ZeroLink 是什么"时
→ 先读 [README.md](../README.zh.md)，再引用 [PRD.md § 1](./PRD.zh.md#1-产品概述)

### 当被问到"如何防止 XXX 攻击"时
→ 先查 [SECURITY.md § 攻击场景分析](./SECURITY.zh.md#攻击场景分析)，找对应章节

### 当需要实现某个功能时
1. 先查 [ARCHITECTURE.md](./ARCHITECTURE.zh.md) 了解整体架构
2. 再查 [PRD.md § 10. API](./PRD.zh.md) 了解接口
3. 最后查对应附录了解精确字节格式

### 当需要写测试时
→ 直接查 [PRD.md § 14](./PRD.zh.md) 和 [PRD.md § 附录 B](./PRD.zh.md#附录-bcanonical-ghost-canon-v1-规范与测试向量强制)

### 当需要审查安全性时
→ 按照 [SECURITY.md § 安全检查清单](./SECURITY.zh.md#安全检查清单implementation) 逐项检查

---

## 文档维护

### 更新规则
- PRD 是权威来源（Single Source of Truth）
- ARCHITECTURE.md 和 SECURITY.md 从 PRD 提取，保持同步
- 任何协议级修改必须先更新 PRD，再更新其他文档

### 版本控制
- 重大协议变更：创建新版本 PRD（如 v2.6.md）
- 小修正：直接更新当前版本，在文档顶部标注修订日期
- 废弃条款：保留但标注 `[已废弃]`

---

**最后更新**：2026-03-11
**当前版本**：v3.0
**维护者**：ZeroLink Team
