# OMP 能力差距分析 — 可提升用户体验的未开发功能

> 探索日期：2026-08-11
> 方法：对照 OMP 16.5.2（当前锁定版）的能力全景（settings-schema 10 大模块 250+ 设置项、19 个工具开关、CLI 模块面）与 Maxma 已接入面，逐项核对缺口。
> 结论先行：OMP 是一座功能富矿，Maxma 目前只挖了约一半；**以下功能全部由 OMP 原生支持，Maxma 只差 UI 与接线**。

---

## 一、OMP 能力全景 vs Maxma 已接入

| OMP 能力模块 | Maxma 状态 |
|---|---|
| 对话/流式/思考/工具调用/审批流/压缩/重试 | ✅ 已接入 |
| MCP / 插件 / Skills / 子 Agent / 自动化 | ✅ 已接入 |
| 权限模式 / 记忆（自定义）/ 规则 / 协作 | ✅ 已接入 |
| **语音输入（STT）** | ❌ 未接入 |
| **语音输出（TTS + speechgen）** | ❌ 设置页是"仅保存"假配置（已置灰） |
| **图片生成（generate_image）** | ❌ 工具未注册、无 UI |
| **网页抓取（fetch）** | ❌ 工具未注册（只有 web_search） |
| **系统通知（completion.notify / ask.notify）** | ❌ 无任何桌面通知 |
| **计划模式开关（plan.enabled / defaultOnStartup）** | ⚠️ 事件/卡片已透传，但无开关 UI |
| **检查点/回退（checkpoint/rewind）** | ⚠️ 工具已注册，但无用户入口 |
| **Goal 模式（goal.enabled）** | ❌ 未接入 |
| **自动学习（autolearn）** | ❌ 未接入 |
| **上下文提升（contextPromotion）** | ❌ 未接入 |
| **会话闲置回顾（recap）** | ❌ 未接入 |
| **Bash 长任务自动后台化（autoBackground）** | ❌ 未接入 |
| **异步任务 UI（async/job）** | ⚠️ job 工具已注册，无 UI |
| **模型 fallback 链（retry.fallbackChains）** | ⚠️ 设置透传了，UI 不可配 |
| **秘密保管库（vault）** | ❌ 未接入（影响凭据安全体验） |
| **Hindsight 回顾 / MnemoPi 记忆** | ❌ 依赖外部服务 / 依赖 fastembed（编译包未打包） |

---

## 二、差距清单（按用户价值 × 开发成本排序）

### A 梯队：立即值得做（OMP 原生支持，主要是 UI + 接线，1-2 天/项）

| # | 功能 | 主流产品对照 | 说明与做法 |
|---|---|---|---|
| A1 | **语音输入（STT）** ✅ 2026-08-12 | 几乎所有 AI 助手标配 | 做法调整：OMP `stt.enabled` 挂在 TUI 输入层（input-controller），sidecar 无输入管线不可复用 → 改走前端 **Web Speech API 听写**（浏览器/OS 内置识别，零 API 成本）：ChatInput 麦克风按钮 + 中间结果实时回显 + 权限/网络错误优雅降级（`web/src/composables/useSpeechInput.ts`） |
| A2 | **TTS 语音朗读（真实接通）** ✅ 2026-08-12 | Claude 桌面端朗读、ChatGPT 语音 | 做法调整：OMP providers.tts（Kokoro/xAI）需额外运行时模型/付费 API → 改走 **WebView2 speechSynthesis 系统语音**（零 API）：消息气泡/ThinkingBlock「朗读」按钮 + 设置页语音面板真实接线（edge-tts/openai-tts 假配置移除并规范化）+ auto_read 自动朗读 |
| A3 | **系统通知** | Claude Code / Cursor 的任务完成通知 | OMP `completion.notify`（任务完成）、`ask.notify`（等待审批/提问时）。做法：前端 Notification API（WebView2 支持）+ 后端事件驱动；审批等待时通知用户是强需求（用户切走窗口时） |
| A4 | ~~图片生成（generate_image）~~ **已砍** | ChatGPT 文生图 | OMP 16.5.2 已内置 `generate_image` 工具，但文生图依赖 provider 图像能力（OpenAI/Gemini/xAI 等均为付费 API）。产品原则：不要求用户额外配置付费 API → **不做**。若未来主流 provider 免费开放图像能力再评估 |
| A5 | **网页抓取（fetch）** ✅ 2026-08-12 | 通用 Agent 工具 | OMP `fetch.enabled` 是 read 工具的 URL 能力（tools/read.ts 门控），非独立工具。已接入 globalPaths 透传（默认 true），read 工具可直接抓取 URL 内容 |
| A6 | **计划模式开关** ✅ 2026-08-12 | Claude Code 的 plan mode | 会话菜单「计划模式」开关 → WS set_plan_mode → sidecar `session.setPlanModeState` + resolve 工具激活（与 CLI /plan 等价）；plan.defaultOnStartup 透传 |
| A7 | **检查点/回退 UI** ✅ 2026-08-12 | Claude Code 的 checkpoint 恢复 | 会话菜单「创建检查点/回到检查点」→ WS checkpoint_action → sidecar 追加指令消息，下一轮由 agent 调用 checkpoint/rewind 工具；checkpoint.enabled 默认注册（CONFIG-INHERIT-001 修复后与工具清单一致） |
| A8 | **自动学习开关** ✅ 2026-08-12 | — | 设置页「交互」区开关（autolearn.enabled），全局设置持久化 |

### B 梯队：中期值得做（接线稍多，2-4 天/项）

| # | 功能 | 说明 |
|---|---|---|
| B1 | **Goal 模式** | OMP `goal.enabled`（目标导向模式，Claude 的 /goal 类似）。做法：会话级模式切换 + goal 状态展示（statusInFooter） |
| B2 | **上下文提升（contextPromotion）** ✅ 2026-08-12 | 重要上下文自动提升防压缩。做法：globalPaths 透传 + 设置页「上下文管理」开关（溢出时自动切更大窗口模型，需配置了更大窗口模型才生效） |
| B3 | **会话闲置回顾（recap）** | OMP `recap.enabled/idleSeconds`（闲置后自动回顾对话）。做法：开关 + 回顾结果作为 notice 展示 |
| B4 | **Bash 长任务后台化** | OMP `bash.autoBackground.enabled`（长命令自动转后台，不阻塞对话）。做法：开关 + 后台任务状态气泡（复用 task 状态 UI） |
| B5 | **异步任务 UI** | OMP `async.enabled/maxJobs`。做法：job 工具状态可视化（当前只有事件流无集中面板） |
| B6 | **模型 fallback 链 UI** | OMP `retry.fallbackChains`（主模型失败自动切换备用）。做法：Provider 设置页加"备用模型"配置——**多 provider 用户的核心可靠性体验** |
| B7 | **秘密保管库（vault）** | OMP `vault.enabled`（密钥安全存储）。做法：设置页密钥管理（当前 api_key 明文在 providers.yaml） |

### C 梯队：依赖外部/高成本（评估后决定）

| # | 功能 | 阻碍 |
|---|---|---|
| C1 | **Hindsight 自动回顾** | 依赖 OMP 服务（hindsight.apiUrl）；Maxma 自己的 Hindsight 设置已置灰"未接入"——若 OMP 服务可用则可接通 |
| C2 | **MnemoPi 语义记忆** | 依赖 fastembed/onnxruntime——编译包未打包（bun-sidecar/build-compiled.mjs 外部化），需评估体积/收益 |
| C3 | **IRC 多 Agent 通信** | OMP 原生支持，但需要理解协议 + 前端多 Agent 对话 UI |
| C4 | **Collab 协作深化** | 已有 CollabView 基础，可接 OMP collab/share 设置（relayUrl/webUrl） |

---

## 三、与主流 Agent 工具的体验差距（用户感知层面）

用户"感觉差距不小"的根源，按感受强度排序：

1. **没有语音交互**（输入/朗读都没有）——主流 AI 助手的标配，最显眼的缺失
2. **没有系统通知**——长任务/审批等待时用户完全无感知，体验断层
3. **没有计划模式开关**——只能在对话中被动触发，无法"先计划后执行"
4. **没有检查点恢复**——长任务出错只能重来，无"后悔药"
5. **不能生成图片/抓取网页**——能力面板比主流工具少两块
6. **无 Goal/自动学习等模式**——高级用户的可玩性不足

---

## 四、建议实施顺序

```
第一批（✅ 已完成 2026-08-12）：
  A3 系统通知 → A2 TTS 朗读 → A6 计划模式 → A7 检查点 UI

第二批（✅ 已完成 2026-08-12）：
  A1 语音输入（Web Speech API 听写）→ A5 fetch（read URL 能力，已验证接线）
  → A8 自动学习 → B6 fallback 链 → B2 上下文提升

第三批（进阶模式）：
  B1 Goal → B3 recap → B4 后台化 → B5 异步面板 → B7 vault

已砍：
  A4 图片生成（依赖付费 provider 图像 API，违反"不要求用户配置付费 API"原则）

按需评估：
  C1-C4（外部依赖/成本高）
```

> **付费 API 门槛原则（2026-08-12 新增）**：所有新增功能不得要求用户额外配置付费 API；
> 功能本质上依赖付费能力（如图片生成）时直接砍掉，除非未来 provider 免费开放。
> 全部功能均为 OMP 16.5.2 原生能力，升级 OMP（见 docs/omp-upgrade-runbook.md）不影响这些开发。
