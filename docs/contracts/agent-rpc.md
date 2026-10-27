# Maxma Agent JSON-RPC 契约（Bun 后端 ↔ pi kernel）

> 版本：v1（阶段〇基线）
> 契约源：`bun-sidecar/src/kernel/bridge-pi.ts`（pi 引擎 handler 的**权威实现**）、`bun-sidecar/src/session-bridge.ts`（方法登记表 / stdio 入口）、`bun-sidecar/src/rpc-types.ts`（类型，滞后项见 §9）
> 变更规则：修改任一方法前，先改本文档并同步实现与类型。
> **传输现状（2026-10-27 核对）：in-process 直调，没有跨进程 JSON-RPC 层。** 后端 `bun-backend/src/server.ts:21-26` 以相对路径 `import { handlePiCreateSession, handlePiSessionRpc } from "../../bun-sidecar/src/kernel/bridge-pi"`，同进程函数调用；`bun-backend/src/routes/sessions.ts:22`、`routes/chat-ws.ts:37-38` 同样直接 import kernel。`session-bridge.ts` 的 stdio 入口（`createInterface({input: process.stdin})`）**已无运行时调用方**（`docs/00-当前架构.md` §2.3 同口径），仅作为 dev 入口（`bun-sidecar/package.json` 的 `main`）与契约测试目标保留。下文 §1–§7 的 JSON-RPC 帧格式因此**只是方法面契约**，不代表线上真有 stdio 传输。
> 帧格式（历史/stdio 形态，供 dev 入口与测试参照）：请求 `{jsonrpc:"2.0", id:number, method, params?}`；响应 `{jsonrpc:"2.0", id, result?}` 或 `{error:{message, data?}}`；事件为通知 `{method:"event", params:{session_id, event: MaxmaEvent}}`（事件词表见 [ws-events.md](ws-events.md) §3.1）。
> ⚠️ 本文档曾长期指认不存在的实现（`api/pi_bridge/rpc_client.py`，阶段二已随 Python 后端移除）。按 `HANDOFF.md`「变更规则」：**代码与文档冲突时以代码为准**——引用本文档前先用 §8 的状态列核对 `bridge-pi.ts`。

## 1. 会话核心

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `create_session` | `{ engine?, model, system_prompt?, append_system_prompt?, cwd?, tools? }` | `{ session_id }` | 建会话；权限模式映射为审批语义。**引擎只有 `pi`**（默认引擎于 2026-09-30 切换，`MAXMA_AGENT_ENGINE=omp` 回退开关已随 OMP 代码一并删除，见 `session-bridge.ts:9,38`；如需回滚旧内核只能用 git 历史）。`engine` 参数不再影响分流。pi 引擎支持参数与 RPC 矩阵见 §8 |
| `prompt` | `{ session_id, message }` | `{ ok: true }` | 提交用户消息；事件经 `event` 通知推送 |
| `steer` | `{ session_id, message }` | `{ ok: true, disposition? }` | 活跃回合中立即注入用户调整；由 Pi 在当前工具调用完成后处理 |
| `follow_up` | `{ session_id, message }` | `{ ok: true, disposition? }` | 活跃回合中排队，当前回合结束后处理 |
| `cancel` | `{ session_id }` | `{ ok: true }` | 中止当前运行（必须走此 RPC，不可只取消 Python 侧任务） |
| `destroy_session` | `{ session_id }` | `{ ok: true }` | 销毁会话并释放资源 |
| `undo` | `{ session_id, steps? }` | `{ removed }` | 回退 N 个回合；前导 system 消息始终保留 |
| `compact` | `{ session_id, keep_last? }` | 压缩结果 | 手动压缩上下文 |
| `get_messages` | `{ session_id, limit? }` | `{ messages: [{role, content}], total }` | 读取消息（SessionMap 不是事实源） |
| `get_health` | `{ session_id }` | 健康信息 | 探活（AUX-STALE-001 依赖） |
| `headless_prompt` | 无头执行参数 | 执行结果 | 无 UI 回合 |

## 2. 审批与权限

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `user_response` | `{ session_id, interaction_id, response }` | `{ ok: true }` | 应答 `ask_user` 审批 |
| `set_auto_approve` | `{ session_id, auto_approve: boolean }` | — | 运行时切换 approvalMode（yolo / always-ask） |

## 3. 计划 / 目标 / 检查点 / 回顾

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `plan_action` | `{ session_id, plan_id, action, modified_plan? }` | — | 计划审批（批准/拒绝/修改） |
| `set_plan_mode` | `{ session_id, enabled }` | `{ ok, enabled }` | 启停计划模式（含 standing resolve handler 安装/卸载） |
| `checkpoint_action` | `{ session_id, action: "save"\|"restore", goal? }` | `{ ok, action }` | 向会话追加显式指令消息，下轮由 agent 调 checkpoint/rewind 工具 |
| `goal_action` | `{ session_id, action: "set"\|"replace"\|"pause"\|"resume"\|"drop", objective?, token_budget? }` | `{ ok, action, state }` | 经 goalRuntime 启停目标模式；状态变化经 `goal_updated` 事件推送 |
| `get_goal_state` | `{ session_id }` | `{ state }` | 查询目标模式状态 |
| `session_recap` | `{ session_id }` | 回顾文本 | 独立订阅捕获 answer，串行进 prompt 队列 |

## 4. MCP

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `reload_mcp` | — | 「需重建 session」提示 | 全局重载（已由 per-session 版本取代） |
| `reload_mcp_for_session` | `{ session_id }` | `{ status: "noop"\|"reloaded", server_count?, tool_count?, detail? }` | 重连 MCP 并 `refreshMCPTools` |
| `get_discovered_mcp` | — | `[{ name, transport, tool_count, status }]` | 汇聚活动会话的 MCP 实态 |

## 5. Settings

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `get_settings` | `{ session_id?, paths: string[] }` | `{ settings: Record<path, value> }` | 读白名单设置键；无效路径静默跳过 |
| `set_settings` | `{ session_id?, path, value }` | `{ ok: true }` | 写设置键 |

已知使用的键（**前端设置面板**依赖；原「Python 侧」表述已失效，`api/routes/settings.py` 随阶段二移除）：真实存在于 pi Settings 树的只有 `compaction.enabled`、`retry.*`、`thinkingBudgets.{minimal,low,medium,high,xhigh,max}`、`steeringMode` / `followUpMode` / `interruptMode`。**`tools.approvalMode`、`compaction.strategy`、`compaction.thresholdPercent`、`compaction.midTurnEnabled`、`compaction.idleEnabled`、`skills.enabled`、`advisor.*` 等均为上一代引擎（OMP）遗留，pi 树中不存在**——历史上写它们是**静默 no-op**（面板上看着能拨、拨了没反应）。

> 现状（2026-10-27，工作区未提交改动）：写路径已改为**显式拒绝**——`bun-backend/src/routes/settings.ts` 的 PUT 分支经 `setSettingValue()` 抛 `SettingRejectedError` 时返回带 `detail`/`code`/`path` 的非 2xx（注释 UX-SETTINGS-FEEDBACK-001：拒绝必须可读，前端会弹 detail），成功响应也回 `engine_real` 字段供前端提示；键清单从 `bun-sidecar/src/kernel/pi-contract.ts` 的 `MAXMA_SETTINGS_KEYS` 取（`settings.ts:27,34`）。
> 该清单的**单一数据源是 `MAXMA_SETTINGS_KEYS`**（每项标 `engineReal` 布尔与原因）。本文档不再维护副本，请只在那里增删。

## 6. 插件与发现（阶段一处置：返回 unsupported + 前端 flag 隐藏）

`list_plugins` / `install_plugin` / `uninstall_plugin` / `set_plugin_enabled` / `get_plugin_detail` / `get_plugin_config` / `update_plugin_config` / `get_discovered_skills` / `get_discovered_extensions`

## 7. 工作流（已判定下线，迁移期保留定义）

`execute_workflow_step`：`{ session_id, step_definition: { step_id, tool, args } }` → `{ ok, step_id }`；发射 `workflow_step_start/end/error` 事件。

> 现状（2026-10-27 核对）：**RPC 本身在 pi 引擎已实现**（`bridge-pi.ts` 的 `execute_workflow_step` 分支，见 §8），下线的只是产品面——自动化功能 `capabilities` 为 false、前端路由守卫隐藏（`HANDOFF.md`「当前限制」）。因此"已判定下线"指功能入口，不指方法未迁移。

## 8. pi 引擎支持矩阵（阶段一进行中）

`create_session(engine="pi")` 登记的会话（独立于 OMP 会话表）当前支持：

| 方法 | 状态 | 说明 |
| --- | --- | --- |
| `prompt` / `cancel` / `destroy_session` / `get_health` / `user_response` | ✅ | done 由 `agent_settled` 触发；审批走官方 `tool_call` 钩子 + ask_user；超时默认拒绝 |
| `undo` | ✅ 官方分支语义 | 会话 append-only：`branch(parentId)` / `resetLeaf()` 移动叶指针形成新分支（条目不删除）。契约保持 `{ removed, turns_removed }`——removed 为离开上下文的条目数 |
| `get_settings` / `set_settings` | ✅ | 官方 SettingsManager 为类型化对象：`getSettings()` 解析点路径（未知键跳过）+ `applyOverrides()`/`flush()` 写入。**注意 pi settings 树与 OMP 键名不同**（如无 `compaction.thresholdPercent`），Maxma 设置面板键需逐键对齐 |
| `checkpoint_action` | ✅ 官方 label/branch | save = `appendLabelChange(leafId, label)`（官方书签载体）；restore = 查找最近 label 条目 → `branch(targetId)`。无需 LLM 回合（OMP 版为追加指令让 agent 调工具），并回 notice 事件 |
| `get_messages` / `compact` | ✅ | 契约形状与 OMP 一致；pi compact 为官方摘要式压缩（消息不删除，`removed_count` 恒 0，摘要 tokens 在 detail） |
| `set_auto_approve` | ✅ | true → `auto`（全自动），false → `ask`（逐次审批）；运行时即时生效 |
| `reload_mcp_for_session` | ✅（重建语义） | 官方语义：MCP 扩展在 session_start 连接，配置变更后需重建会话 |
| Maxma 自定义工具（4 个） | ✅ | 官方 `defineTool`（TypeBox `Type.Unsafe` 包装 plain JSON Schema）+ `customTools` 注入；approval 字段 → 官方 `annotations`。工具实现位于 `src/tools/*` descriptor（双端共用，零引擎 import）；`list_automations` 按 §7.5 不进 pi 引擎 |
| MaxmaBlocker 拒止锚 | ✅ | 官方 `tool_call` 钩子执行前 block（`create_session` 恒装配）；命中回因给 agent，整轮不中断 |
| MCP（`mcp_servers.yaml`） | ✅ 基础 | stdio + streamable_http 经 `createMcpExtension(loadConfig)` 注入；allow/block → 官方 `exposure`/`toolExposure`；sse/websocket → unsupported |
| create_session 的 `model` / `provider` / `api_key` / `base_url` / `thinking_level` / `max_tokens` | ✅ | 官方 ModelRuntime（示例 09 `setRuntimeApiKey` + `registerProvider` 自定义端点）；registry 未命中且无 baseUrl 时明确报错 |
| `set_plan_mode` / `plan_action` | ✅ 自建 | pi 无计划模式运行时：官方 `followUp` 注入计划指令 + `submit_plan` 官方自定义工具提交审批；`plan_proposed`/`plan_completed` 契约 payload 不变；审批超时 10 分钟按拒绝 |
| `goal_action` / `get_goal_state` | ✅ 自建 | 官方 custom entry 持久化（`maxma:goal`）+ `goal_updated` 事件（契约 payload 不变）+ `followUp` 注入目标提醒；契约返回 `{ok, action, state}` 与 `{state}` 形状不变 |
| `session_recap` | ✅ 已迁移 | `bridge-pi.ts` 的 `session_recap` 分支（2026-10-27 位于 :716，行号随改动漂移，请以分支名定位）：官方 `getLastAssistantText()` 捕获答案（取代 OMP 版独立订阅），30s 兜底超时返回空内容（前端对空回顾静默跳过）；RECAP-SILENT-001 期间 `suppressEvents=true`，订阅层丢弃流式/done 事件 |
| `execute_workflow_step` | ✅ 已迁移 | `bridge-pi.ts` 的 `execute_workflow_step` 分支（:748）：step 转 prompt 直调，事件经订阅层流给前端，step 起止契约不变 |
| `headless_prompt` / 插件与发现类（§6） | ⏳ 未迁移 | 落到 `bridge-pi.ts` 末尾的兜底（:778），显式返回 `pi engine: method "..." not yet migrated`（不允许静默黑洞） |

> ⚠️ **§8 曾长期滞后于代码**：`session_recap` 与 `execute_workflow_step` 在本表被标为「⏳ 未迁移」长达近一个月，而 `bridge-pi.ts` 早已实现——2026-10-27 的一次解耦调查因此误判「回顾功能不可用」。本表状态列请以 `bridge-pi.ts` 的 `if (method === "...")` 分支为准。

## 9. 已知不一致（替换期需对齐）

1. **`rpc-types.ts` 的 `RpcMethodName` 联合与实现三方漂移**（2026-10-27 核对，数字为人工统计，**以 `bridge-pi.ts` 的 `if (method === "...")` 分支为准**）：
   - kernel 实际实现 **23** 个方法名（另有 `create_session` 走 `handlePiCreateSession` 独立入口，合计 **24**）；
   - `rpc-types.ts` 联合声明 **27** 个成员，其中 **9 个已实现却未列入联合**：`checkpoint_action`、`clear_messages`、`follow_up`、`get_goal_state`、`goal_action`、`session_recap`、`set_permission_mode`、`set_plan_mode`、`steer`；**13 个列入联合但 kernel 无分支**（`headless_prompt`、§6 插件/发现类、已被 per-session 版取代的 `reload_mcp` 等，走 :762 兜底）；
   - `session-bridge.ts` 的方法登记表只列 **21** 个，**不含 `clear_messages` / `session_recap` / `set_permission_mode`**（这三个 kernel 已实现，经 `bun-backend` 直调可用，但走 stdio 入口会被判 `Unknown method`）。
   - 旧表述「以 `session-bridge.ts` dispatcher 为权威（32 个 handler）」作废：该数字属 OMP 时代，且今天权威实现是 `bridge-pi.ts`，`session-bridge.ts` 已无运行时调用方（见文首「传输现状」）。
2. 插件/发现类 RPC 的参数/返回类型未在 `rpc-types.ts` 定义。
3. 阶段一约束：**RPC 面不变**（§1–3 必须逐方法等价实现）；§6 返回 unsupported；§7 随下线决策处理；pi 引擎支持矩阵见 §8。
