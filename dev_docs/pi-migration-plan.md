# Maxma Agent 层迁移方案：OMP → pi（含前后端解耦）

> 状态：方案（已确认，可开工）
> 日期：2026-09-29
> 基线：main @ `348c585`，v2.6.11，OMP v16.5.2
> 决策：两阶段走 —— 先换内核（保留 Python），再统一后端（移除 Python）。每阶段独立可交付、独立可回滚。
> 决策补充（2026-09-29）：① 凭据信封采用 encv2 + 一次性迁移（设计见 §8.1）；② 插件功能保留并重建，collab / deferred_runs 等半成品功能下线（处置清单见 §7.5）。

---

## 1. 背景与目标

MaxmaHere 当前用 oh-my-pi（OMP）作为 Agent 能力层。OMP 是 pi（[earendil-works/pi](https://github.com/earendil-works/pi)）的下游二次开发版，叠加了大量自有机制（审批/权限、settings 树、catalog、plan/goal 模式、插件体系）。这些机制带来两难：Maxma 的安全与功能深度绑定 OMP 语义，但 OMP 的二次开发同时引入了 Maxma 不需要的限制，且无法影响其演进方向。

目标：

1. Agent 能力层直接基于原始 pi（npm `@earendil-works/*`），Maxma 自持全部增强逻辑。
2. 前端 ↔ 后端以显式版本化契约为唯一耦合点，后端内部实现可整体替换。
3. 终态：单一 Bun/TS 后端（API 层 + 持久层 + pi 内嵌），移除 Python。

## 2. 现状耦合地图

三层结构中，OMP 耦合只存在于 sidecar 一层——这是本迁移可行的前提。

```text
Vue 前端 ──(REST + WS, ws_protocol.py)── Python 后端 ──(JSON-RPC stdio)── Bun sidecar ──(@oh-my-pi/*)── OMP
```

### 2.1 sidecar 的 OMP 依赖面（全部清单）

包依赖：`@oh-my-pi/pi-agent-core`、`pi-ai`、`pi-catalog`、`pi-coding-agent`（各 16.5.2）。

| 类别 | 具体 API / 子路径导出 | 使用位置 |
| --- | --- | --- |
| 会话 | `createAgentSession` / `AgentSession`（prompt、subscribe、abort、dispose、waitForIdle、getActiveToolNames、setActiveToolsByName、refreshMCPTools） | session-bridge.ts、mcp.ts、events.ts |
| OMP 专有会话 | `setPlanModeState`、`sendPlanModeContext`、`getGoalModeState`、`resolveApprovedPlan`（`/plan-mode/approved-plan`） | session-bridge.ts、plan-bridge.ts |
| 审批 UI | `ExtensionUIContext` / `ExtensionUIDialogOptions` / `ExtensionUISelectItem`（`ctx.select("Allow tool: …")` 标题解析式审批） | approval.ts |
| 配置 | `Settings`、`AuthStorage`、`discoverAuthStorage`、`SettingPath`（`/config/settings-schema`），settings 键如 `tools.approvalMode`、`compaction.*` | omp-compat.ts、session-bridge.ts |
| MCP | `MCPManager` / `MCPServerConfig`（`/mcp`） | mcp.ts |
| 事件 | `EventBus`（`/utils/event-bus`）、`TASK_SUBAGENT_LIFECYCLE_CHANNEL`（`/task`） | session-bridge.ts、omp-compat.ts |
| 扩展 | `ExtensionActions` / `ExtensionContextActions`（`/extensibility/extensions`） | omp-compat.ts |
| 模型 | `getBundledModel`（pi-catalog `/models`）、`GeneratedProvider`、`Model`（pi-ai） | model.ts、omp-compat.ts |
| 工具 | `ToolDefinition`（zod schema） | tools/×5 + blocker.ts |
| 路径工具 | `resolveLocalUrlToPath`（`/internal-urls`）、`normalizeLocalScheme`（`/tools/path-utils`） | artifacts 处理 |

### 2.2 Python / 前端的 OMP 语义泄漏点

协议本身（WS 事件枚举、JSON-RPC 方法）是 Maxma 自有语义，不耦合 OMP；泄漏集中在配置面路由：

- `api/routes/settings.py` / `settings_panels.py`：透传 OMP settings 树（compaction/retry/推理预算等键）
- `api/routes/plugins.py` + 前端 `PluginListView`：OMP 插件市场 RPC
- `api/routes/capabilities.py`：配置源检测含 OMP 配置文件实态
- 扩展发现：`get_discovered_skills/extensions` RPC 依赖 OMP 资源发现

## 3. pi 对照分析

pi 现状（2026-09）：npm `@earendil-works/pi-coding-agent@0.87.1`（7 天前发布，Node ≥ 22.19，明确支持 Bun 内嵌），MIT，monorepo 含 `pi-agent-core` / `pi-ai` / `pi-coding-agent` / `chord` / `pi-tui` / `pi-durable` / `pi-telemetry` 及内置 `mcp`、`codemode` 扩展包。日提交活跃（6500+ commits），0.x 阶段 API churn 快。

### 3.1 同源可直接复用（OMP fork 自 pi，核心形状一致）

| 能力 | pi API |
| --- | --- |
| 会话创建 | `createAgentSession({ cwd, model, thinkingLevel, scopedModels, settingsManager, sessionManager, resourceLoader, tools/noTools/excludeTools/customTools })` |
| 会话操作 | `session.prompt/steer/followUp/abort/waitForIdle/dispose`、`session.messages/model/systemPrompt/getActiveToolNames` |
| 会话持久化 | `SessionManager`（JSONL 持久化 / `inMemory()`），分支/压缩内置 |
| 模型 | `pi-ai` 统一多 Provider API，`Model` 对象、自定义端点 |
| SDK 隔离边界 | `settingsManager` / `sessionManager` / `resourceLoader` 均可注入自定义实现（SDK 示例 10/11/12） |

### 3.2 pi 没有、Maxma 必须自建（本方案核心工作量）

| 能力 | pi 现状 | Maxma 自建方式 |
| --- | --- | --- |
| **工具审批/权限** | 无权限系统 | 扩展 `pi.on("tool_call")` 返回 `{ block: true, reason }` 前异步等待前端 `user_response`；4 档权限模式映射照旧。**结构化事件取代 OMP 的标题字符串解析（parseApprovalTitle 可删除）** |
| MaxmaBlocker | 无 | 同上 `tool_call` 钩子解析路径参数命中 `.maxma_blocker` 即 block——**执行前拦截，优于现有事件层 abort（无部分副作用）** |
| Plan 模式 | 无 | 扩展：system prompt 注入 + `pi.sendMessage`（steer）+ 提案解析；现有 plan-bridge 逻辑平移 |
| Goal 模式 / Checkpoint / Recap | 无 | 扩展：`pi.appendEntry`（自定义会话条目持久化）+ steer + 消息裁剪 |
| OMP settings 树 | pi 有自己的 settings 体系（`SettingsManager`，可注入） | Maxma 设置面板改为读写 pi settings 的白名单子集 + Maxma 自有配置 |
| 插件市场（list/install/…） | 无对应物（pi 用 extensions/packages，语义不同） | 已确认保留重建：阶段一过渡隐藏，阶段二基于 pi 扩展/包体系重建（§7.5） |
| 子 Agent 生命周期事件 | 待验证（`TASK_SUBAGENT_LIFECYCLE_CHANNEL` 为 OMP 专有） | 验证 pi 嵌套工具事件（`nestedCalls`、`parentToolCallId`）；无则 feature flag 关闭 SubAgentCard |

### 3.3 pi 更优、直接受益

- **MCP**：`createMcpExtension()`（stdio + streamable HTTP + OAuth），比 OMP MCPManager 新；仍可经 `pi.registerMcpServer()` 从 `mcp_servers.yaml` 注入并保留 allow/block 工具过滤。
- **工具暴露控制**：`exposure`（direct/model-only/codemode/deferred/hidden）+ `pi.setActiveTools()`，替代现有 setActiveToolsByName 过滤。
- **无外部审批字符串协议**：`ctx.ui.confirm/custom` + `ctx.hasUI`，RPC/无 UI 模式有官方约定。
- **生命周期钩子**：`session_start/session_shutdown/turn_end/agent_before_settle` 可承载 Maxma 的持久化与收尾逻辑。

## 4. 终态架构与路线

```text
【终态】
Vue 前端 (web/)
   │  Maxma 契约 v1：REST + WS 事件（版本化、双端校验、快照测试锁定）
   ▼
Maxma 后端 (Bun + TypeScript，单一进程)
   ├─ API 层：路由、token 鉴权、CORS、限流、WS 网关
   ├─ 领域层：会话 / providers(凭据) / 记忆 / 贴纸 / 工作流 / 活动流 / 指标 / 引导
   ├─ 持久层：bun:sqlite + Bun.YAML（沿用现有文件格式，零数据迁移）
   └─ Agent 内核 (maxma-agent/)：pi SDK in-process + Maxma 扩展集
        ├─ approval 扩展（tool_call block ←→ 前端审批）
        ├─ blocker 扩展（路径拒止）
        ├─ plan / goal / checkpoint / recap 扩展
        ├─ mcp 装配（createMcpExtension + mcp_servers.yaml + allow/block）
        └─ 自定义工具 ×5（memory/stickers/rules/automations）
```

两阶段路线：

| 阶段 | 内容 | Python | 交付判据 |
| --- | --- | --- | --- |
| **阶段〇** | 契约固化 + 回归基线（两阶段共用的地基） | 保留 | 契约文档 + 双端 schema 校验 + 端到端事件快照测试入库 |
| **阶段一** | sidecar 内核替换 OMP→pi；RPC 面不变 | 保留 | 三套测试全绿，前端零改动，行为与基线一致 |
| **阶段二** | 新建 Bun/TS 统一后端（内嵌阶段一内核），移除 Python | 移除 | 新后端通过同一契约测试套；打包产物/启动验证；旧代码归档 |

阶段一独立产生价值（解除 OMP 限制、拿到 pi 结构化钩子），即使阶段二暂缓也可长期运行。阶段一的 Agent 内核按「可 in-process 复用」设计，阶段二直接 import，不重写。

## 5. 阶段〇：契约固化与回归基线

> 目标：把「前端—后端—Agent 层」之间的事实协议变成显式契约，为后续两阶段提供不变的判据。

1. **WS 事件契约**：以 `api/ws_protocol.py`（枚举）+ `web/src/utils/wsProtocol.ts` + `web/src/types/` 为源，产出 `docs/contracts/ws-events.md` + JSON Schema（每事件类型的必填/可选字段）。双端加载同一 Schema 做校验测试。
2. **JSON-RPC 契约**：以 `bun-sidecar/src/rpc-types.ts` + `api/pi_bridge/rpc_client.py` 为源，产出 `docs/contracts/agent-rpc.md`（方法、参数、返回、错误码）。
3. **协议握手**：WS 连接建立后首条 `hello` 消息携带 `protocol_version` + `features`（能力开关），为阶段二并行运行留出协商空间。前端已具备 capabilities feature 守卫（`router/index.ts` meta.feature），沿用。
4. **端到端快照测试**：录制 N 条典型对话（纯文本 / 工具调用 / 审批拒绝 / plan 提案 / MCP 工具 / 错误 / 取消）的 Maxma WS 事件序列为 golden 快照。阶段一、二的任何改动必须让快照全绿（允许显式 review 后更新）。
5. **泄漏点清单入库**：§2.2 四处泄漏点登记为阶段一/二的整改项。

## 6. 阶段一：sidecar 内核替换（Python 保留）

> 目标：`bun-sidecar` 的 `@oh-my-pi/*` 全量换为 `@earendil-works/*`，RPC 面不变 → Python 与前端零改动。

### 6.0 Spike 结论（2026-09-29 实测，`tmp/pi-spike/`）

用项目自带 Bun 1.3.14 实测 npm `@earendil-works/pi-coding-agent`：

| 验证点 | 结果 |
| --- | --- |
| Bun 1.3.14 可运行 | ✅ 会话创建→订阅→销毁全链路 OK |
| 官方文档 API 一致性 | ✅ `createAgentSession`/`SessionManager`/`DefaultResourceLoader`/`session.prompt/steer/followUp/abort/waitForIdle/dispose/subscribe/getActiveToolNames/bindExtensions` 全部存在且形状与文档一致 |
| MCP 扩展 | ✅ **须用 0.99.0**（今日发布，与官方文档同步）。0.87.1 及更早版本完全不含 MCP；`createMcpExtension` 为顶层导出 |
| 会话持久化/导入 | ✅ `SessionManager` 静态方法：`create/open/continueRecent/inMemory/forkFrom/findById/list/listAll`；原型含 `appendCustomEntry/appendCustomMessageEntry/appendLabelChange/appendContextEdit/appendCompaction/getBranch/branch/resetLeaf`；并有 `parseSessionEntries`/`migrateSessionEntries`/`CURRENT_SESSION_VERSION` 迁移辅助——Checkpoint 用 `label`、Goal/Recap 用 `custom` entry 均有官方载体 |
| 插件机制 | ✅ `DefaultPackageManager` + `getPackageDir` + `package-manager-cli`——官方 packages 机制存在，插件重建有承接点（细节待开发时核读） |
| 子 Agent 事件 | ❌ 无任何 subagent 导出——`sub_session_created` 确认无 pi 等价物，按 §6.2 任务 10 flag 关闭 |
| 权限模式映射素材 | ✅ `createReadOnlyTools`/`createCodingTools`/`createBashTool`/`createPowerShellTool` 等工具工厂 + `defineTool`/`wrapRegisteredTools`——4 档权限的工具集切换可全部用官方工厂组装 |
| Settings | ✅ `SettingsManager` + `DEFAULT_COMPACTION_SETTINGS`（压缩键官方存在） |
| 默认工具集 | `read/bash/edit/write/grep/find/ls`（无 OMP 的 plan/todo 等专有工具） |
| 版本锁定 | **锁 `0.99.0`**。注意：npm 版本跳跃大（0.87.1→0.99.0 隔 12 天），锁精确版本 + 升级跑快照是硬约束 |

**结论**：阶段一技术路径全部可行，无阻断项；所有自建能力均有官方 API 承接，无需自创机制。

### 6.1 依赖与目录

- `bun-sidecar/package.json` 引入 `@earendil-works/pi-coding-agent`、`pi-agent-core`、`pi-ai`（**精确锁 `0.99.0`**，spike 实测版本；0.x 生态升级走独立 PR + 快照验证）。
- 新建 `bun-sidecar/src/kernel/`：`MaxmaSession` 接口（create/prompt/steer/abort/undo/compact/messages/dispose/subscribe）+ `pi-session.ts` 实现 + `extensions/`（Maxma 扩展集）。`session-bridge.ts` 只依赖 `MaxmaSession` 接口，不直接 import pi——阶段二整目录搬运。

### 6.2 任务分解

| # | 任务 | 要点 |
| --- | --- | --- |
| 1 | 事件桥重写 | `events.ts` 的 `mapPiEventToMaxma` 按 pi 事件词表重写：`message_update.assistantMessageEvent`（text_delta 等）→ `token/thinking_delta`；`message_end` → 权威消息；`agent_settled` → `done`；工具执行事件 → `tool_update/tool_end`；compaction → `context_compressed`。Maxma WS 事件名与字段不变 |
| 2 | 审批扩展 | `extensions/approval.ts`：`pi.on("tool_call")` 内按 4 档权限模式判定；需审批时发 `ask_user`（携带结构化 toolName/toolInput/riskLevel——不再需要 parseApprovalTitle）→ 等待 `user_response` RPC → 放行或 `{block, reason}`；超时默认拒绝（沿用 `APPROVAL_TIMEOUT_MS`） |
| 3 | Blocker 扩展 | `extensions/blocker.ts`：`tool_call` 钩子解析路径参数 → 父目录遍历 `.maxma_blocker` → block。与 `api/routes/maxma_blocker.py` 的文件名约定保持一致（抽到共享常量文档） |
| 4 | Plan/Goal/Checkpoint/Recap 扩展 | plan：system prompt 注入 + `sendMessage` steer + 提案解析（平移 plan-bridge 逻辑）；goal/checkpoint/recap：`pi.appendEntry` 持久化 + steer。RPC 方法名不变 |
| 5 | 自定义工具迁移 | `tools/`×4（remember_memory、search_memories、get_sticker、list_rules）从 OMP `ToolDefinition`(zod) 改为 pi `registerTool`（TypeBox schema + `content`/`details` 返回）；或经 `createAgentSession({ customTools })` 注入（以 pi 0.87 实际签名为准，落在 kernel 内）。`list_automations` 不迁移（automation 已判定下线，见 §7.5） |
| 6 | MCP 装配 | `mcp.ts`：`DefaultResourceLoader.extensionFactories` 挂 `createMcpExtension()`，`session.bindExtensions()`；`mcp_servers.yaml` → `registerMcpServer`；保留 allow/block 过滤（`exposure`/`setActiveTools` 实现）；`reload_mcp_for_session` 语义保持 |
| 7 | 模型与凭据 | `model.ts`：pi-catalog 无 bundled 模型目录 → pi-ai 模型注册表 + 自定义 `Model` 构造兜底（现 Option B 保留）；`providers.yaml` 解密后的 key/base_url 注入方式参照 SDK 示例 09（credentials/model storage） |
| 8 | Settings 装配 | 注入 `SettingsManager`（内存态，由 Python 侧 RPC 供给）；`get/set_settings` RPC 白名单键改为 Maxma 语义（compaction/retry 映射到 pi settings 实际键名，逐键核对 pi settings 文档） |
| 9 | 会话持久化 | pi `SessionManager` 持久化模式（JSONL）对接 SessionMap；`get_messages/undo/compact` 按 pi 消息结构重实现，保持返回形状 |
| 10 | OMP-only RPC 处置 | `list_plugins` 等 7 个插件 RPC 与 `get_discovered_skills/extensions`：阶段一返回 `unsupported` 错误码 + 前端对应面板由 capabilities feature flag 隐藏（router 已支持）。插件功能已确认保留——阶段二基于 pi 扩展/包体系重建（§7.5），阶段一为过渡性降级。`sub_session_created`：验证 pi 嵌套调用事件，无则临时关闭 |
| 11 | 测试 | `bun test` 套件重写（rpc/mcp/pure/approval/tools）；阶段〇快照全绿；`pytest -q` 与 `vitest` 零改动通过 |

### 6.3 验收

- 三套测试全绿；快照一致；审批/取消/MCP 热重载/便携版构建手测通过。
- `@oh-my-pi/*` 从依赖树移除，`omp-compat.ts` 删除（其职责由 kernel 接口承担）。

#### 6.3.1 OMP 依赖解除 —— 硬判据（用户明示：不留并存、不留兼容层）

阶段一完成态必须满足全部 5 条，缺一项即视为未完成。**状态（2026-09-30）：全部达成**：

1. ✅ `bun-sidecar/package.json` 与 `bun.lock` 中无任何 `@oh-my-pi/*`（bun remove 四包；连带移除未使用的 zod）。
2. ✅ `src/`、`tests/` 零 `@oh-my-pi` import。原 15 个文件处置：
   - `events.ts`/`mcp.ts`/`model.ts`/`state.ts` → kernel 同名能力替代，删除
   - `approval.ts`/`plan-bridge.ts` → kernel/approval-gate + kernel/plan 替代，删除
   - `omp-compat.ts`、`types/omp-event-bus.d.ts` → 删除
   - `tools/index.ts`、`tools/automations.ts` → 删除（工具实现已抽 descriptor；list_automations 随 automation 下线）
   - `rpc.ts` → 清理为纯 JSON-RPC 原语；`session-bridge.ts` → 重写为纯 pi 入口
3. ✅ `omp-compat.ts` 及 `types/omp-event-bus.d.ts` 已删除。
4. ✅ 编译产物核查（2026-09-30）：`bun build --compile` 产物 `maxma-engine.exe` **105.2MB**（旧 OMP 版 124.9MB，**-19.7MB**）；二进制零 `oh-my-pi` 引用、pi 引用 621 处；真机冒烟通过（stdin JSON-RPC → create_session 返回真实 session_id）。SMOKE-ENTRY-001：入口装配层冒烟测试入库（tests/entry-smoke.test.ts）——单测直调 kernel 不经装配层，漏 import 类错误只有入口冒烟能抓。
   **桌面壳变更（2026-09-30）**：Tauri 构建链（Rust/tauri CLI）被卸载，便携/安装版形态暂停。保底方案落地（WEB-HOST-001）：`MAXMA_SERVE_WEB=1` 时 FastAPI 托管 `web/dist`（SPA fallback + 静态资源免鉴权，前端 token 运行时获取已是形态无关），启动器 `start-web.bat`（后端 → 就绪探测 → 打开浏览器；pi 引擎由 sidecar_manager 自动拉起）。Electron 迁移评估结论：依赖面小（前端仅 4 文件、invoke 2 处、tauriFetch 已内置浏览器回退），代价中等（main.rs 1289 行职责 TS 重写 + 体积 +90~150MB），作为独立工作项后议。
5. ✅ 逐模块处置到位：`tools/*`→descriptor 双端共用 + kernel 官方 `defineTool` 适配；审批→官方 `tool_call` 钩子；计划→kernel/plan；事件→kernel/events；MCP→kernel/mcp；模型→kernel/model；状态→PiSessionRecord。

执行顺序：功能逐个迁移 ✅ → 默认引擎切 pi ✅（2026-09-30，MAXMA_AGENT_ENGINE 开关随 OMP 删除）→ 删除 OMP 代码与依赖 ✅ → 产物核查 ✅。

**发布前人工验证项**：真机配好模型后跑一次完整对话（含工具调用、审批、计划模式、checkpoint），确认端到端行为。

## 7. 阶段二：统一 Bun/TS 后端（移除 Python）

> 目标：新建 Maxma 后端（Bun + TS），API 层 + 持久层 + 阶段一内核 in-process；Tauri 与打包链切换；归档 Python。

### 7.1 技术选型

- 运行时 Bun（pi 官方支持内嵌 Bun）；Web 框架 **Hono**（Bun 原生、轻、WS 支持好）；SQLite 用 `bun:sqlite`；YAML 用 `Bun.YAML`；token 估算用 `js-tiktoken`（替换仅有的 tiktoken 使用点 `context_usage.py`）。
- 后端目录 `server/`（新顶层），与 `bun-sidecar` 的 `kernel/` 合并为 `server/src/agent/`。

### 7.2 模块移植顺序（依赖序）

| 批次 | 模块（源自 api/） | 说明 |
| --- | --- | --- |
| B0 | server.py→app 工厂、health、auth(middleware+db/auth)、cors、errors、logging | 骨架先行；token 鉴权语义逐条对齐 |
| B1 | session_manager、sessions、chat(WS)、ws_protocol、ws_registry、pi_bridge→直连内核 | **最大风险批**：`chat.py` 1667 行的事件转发逻辑改为进程内订阅，无 JSON-RPC 跳数 |
| B2 | providers、db/providers、credential_envelope、credential_mask | 见 §8 凭据决策 |
| B3 | memory、persona、stickers×3、rules、news、onboarding | 纯 YAML/SQLite 读写，机械移植 |
| B4 | activity_hub、metrics、diagnostics、audit_log、context_usage、transcripts、balance、files、upload | 可观测与文件域 |
| B5 | capabilities、settings_panels、mcp_validation、path_whitelist、maxma_blocker、restart + 插件重建 | 配置面重写为 Maxma 自有语义；下线模块不移植（§7.5）；插件基于 pi 扩展/包体系重建 |

### 7.3 壳与打包

- Tauri sidecar 改为 `bun build --compile` 产物（单 exe，估计 100–200MB，替代 PyInstaller 13MB bootloader + 1.4GB `_internal`）；`main.rs` 的端口管理 / 健康等待 / Job Object / 崩溃重启逻辑不变，仅改产物路径与健康检查参数。
- 便携版：`build-portable.bat` 流程重写——去掉 Python venv/PyInstaller/prepare-runtime 的 Python 分支；`resources/runtime/` 保留 Node（MCP stdio server 子进程仍需要）；预期总体积 1.6GB → 数百 MB。
- `app_paths.py` 的开发/冻结双模式路径契约 → TS 等价实现（`portable.flag` 契约不变）。

### 7.4 切换与归档

- 新旧后端以阶段〇契约测试套 + 快照做并行验收（同一前端指向两个端口对照）。
- 通过后：`api/`、`main.py`、`tests/`（Python）、`requirements*.txt`、`build/maxma-server.spec`、`constraints.txt` 归档至 `archive/python-backend/`（保留一个 tag 供回滚：`vLast-python-backend`）。
- 文档同步：`docs/00-当前架构.md`、`PROJECT_INDEX.md`、`HANDOFF.md`、安全契约（路径白名单/fail-closed 原则逐条复核在新实现中的落点）。

### 7.5 功能处置清单（2026-09-29 已确认）

| 处置 | 模块 | 说明 |
| --- | --- | --- |
| 保留·重建 | 插件（`PluginListView`/`PluginDetailView`、`routes/plugins.py`、sidecar 7 个插件 RPC） | 用户确认保留。阶段二基于 pi 扩展/包体系（packages/extensions）重建安装/卸载/启停/配置管理；开工前先调研 pi packages 机制（列入 spike 项） |
| 移除 | 协作 collab（`CollabView`、`routes/collab.py`、`stores/collab.ts`、`types/collab.ts`）及分享入口（`ShareView`，依赖协作域） | 半成品，确认下线 |
| 移除 | deferred_runs（`routes/deferred_runs.py`） | 默认关闭、UI 未暴露 |
| 移除（判定） | automation（`AutomationView`、`routes/automation.py`、sidecar `tools/automations.ts`、`list_automations` 工具） | 半成品且属低频能力；如需保留请在阶段一开工前说明（届时 §6.2 任务 5 恢复 ×5） |
| 移除（判定） | workflows（`routes/workflows.py`、前端 workflow 类型与工作台入口、`execute_workflow_step` RPC） | 低频能力；如需保留请在阶段一开工前说明 |
| 移除（判定） | 扩展管理（`ExtensionView`、`get_discovered_skills/extensions` RPC） | OMP 扩展体系在 pi 中不存在；pi 扩展由 Maxma 内核自持，无需用户管理界面 |

> 「移除（判定）」为按「不常用功能去掉」授权做出的判定，开发前如有异议可单独恢复；明确移除项不再回退。前端对应视图、路由、store、类型同步删除，capabilities feature 清单同步裁剪。

## 8. 数据、凭据与打包迁移

| 项 | 现状 | 策略 |
| --- | --- | --- |
| YAML 数据（providers/mcp_servers/auth_token/path_whitelist/maxma_blocker/news/personas/memory） | PyYAML | Bun.YAML 同格式读写，**零迁移** |
| SQLite（auth/metrics/providers/session_map） | aiosqlite | bun:sqlite 直读现有库文件；schema 不变则零迁移，变更则启动时轻量 migration |
| 前端 localStorage turns | 不变 | 不涉及 |
| **凭据信封 encv1** | Windows DPAPI / 其他平台 Fernet（`cryptography`） | 已确认：引入 `encv2`（TS 自持）+ 一次性迁移，设计见 §8.1 |
| 会话历史（OMP session 文件 / session_map.db） | OMP JSONL | pi SessionManager JSONL 格式不同 → 阶段一提供一次性导入（`importFromJsonl` 能力待验证；不可则旧会话只读归档、新会话新格式） |

### 8.1 凭据信封 encv2 设计（已确认）

- **格式**：沿用信封结构，前缀 `encv2:`，payload 为 base64(JSON)：`{ version: 2, algorithm: "A256GCM", key_id, iv, ciphertext }`。`credential_mask.py`（阶段二为其 TS 等价）的脱敏逻辑不变。
- **加密原语**：AES-256-GCM，Bun/WebCrypto 原生支持，零第三方依赖。
- **主密钥管理**（平台分治）：
  - Windows（主场景）：首启生成 32B 随机主密钥，经 `bun:ffi` 调 DPAPI（`CryptProtectData`，用户域）加密后落 `%APPDATA%/MaxmaHere/credentials.key`——安全属性与现 encv1 的 DPAPI 一致。
  - 非 Windows：主密钥文件存应用数据目录，权限 600。
  - `key_id` 预留密钥轮换（首版固定 `k1`）。
- **一次性迁移**（幂等，阶段二新后端启动时执行）：
  1. 扫描信封存储点（`providers.yaml`、`auth_token.yaml` 等）中的 `encv1:` / `enc:` 值；
  2. 解密——Windows：`CryptUnprotectData`（`bun:ffi`）；非 Windows：Fernet（AES-128-CBC + HMAC-SHA256，WebCrypto 可直接实现，无需 Python）；
  3. 重加密为 encv2，原子写回（tmp + rename），原文件备份 `*.encv1.bak`；
  4. 解密失败：保留原值、明示报错要求重录 API Key——fail-closed，不静默。
- **验收**：迁移完成后 Python 侧不再参与任何加解密；信封识别函数在迁移期同时识别 encv1（只读）与 encv2（读写）。

## 9. 风险与对策

| 风险 | 等级 | 对策 |
| --- | --- | --- |
| pi 0.x API churn（一年 0.5→0.87） | 高 | 精确锁版本；kernel 接口隔离（升级只动 `kernel/pi-session.ts` + extensions）；升级 runbook 固化（参照 docs/omp-upgrade-runbook.md 模式） |
| 事件语义差异导致前端行为回归 | 高 | 阶段〇快照测试为硬门禁；`agent_end` vs `agent_settled`、队列/重试/压缩事件逐一对拍 |
| 审批时序（钩子内异步等前端） | 中 | block 钩子内 await + 超时默认拒绝 + 取消传播（abort 时 reject 所有 pending 审批） |
| 子 Agent 事件 / SessionManager 导入等「待验证」项 | 中 | 阶段一第 0 个 spike：用 SDK 示例 11/13/14 验证三个未知点，再进入正式开发 |
| 阶段二移植面大（85 文件→约 20 模块） | 中 | 批次 B0–B5 每批以契约测试验收；下线模块（§7.5）不移植，缩小移植面 |
| 安全回归（路径白名单、fail-closed、凭据不落日志） | 高 | 安全契约逐条映射到新实现 + 专项测试（对应 tests/ 中 security 相关用例在 TS 侧重写）；发布前手测清单 |
| 打包链路（Bun compile + Tauri + Windows） | 中 | 阶段二先出最小可启动 exe 验证壳链路，再接业务批次 |

## 10. 验收标准（总）

1. `@oh-my-pi/*` 在依赖树中完全消失；Agent 能力全部来自 `@earendil-works/*`。
2. 前端在阶段一、二的任意切换点上零改动可用（契约测试 + 快照证明）。
3. 三层测试（阶段二后为两套：bun test + vitest）全绿；便携版可构建、可启动、体积与启动时间不劣于现状（阶段二应显著优于）。
4. 安全契约文档与实现一致：空白名单默认拒绝、fail-closed、凭据不进日志/事件/前端、MCP stdio 白名单、Provider URL 校验。
5. 升级 runbook 存在：锁版本、升级步骤、回归清单。
