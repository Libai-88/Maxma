# Maxma Agent JSON-RPC 契约（Python ↔ Bun sidecar）

> 版本：v1（阶段〇基线）
> 契约源：`bun-sidecar/src/session-bridge.ts`（dispatcher，权威实现）、`bun-sidecar/src/rpc-types.ts`（类型）、`api/pi_bridge/rpc_client.py`（客户端）
> 变更规则：修改任一方法前，先改本文档并同步双端实现与类型。
> 传输：JSON-RPC 2.0 over stdio。请求 `{jsonrpc:"2.0", id:number, method, params?}`；响应 `{jsonrpc:"2.0", id, result?}` 或 `{error:{message, data?}}`；事件为通知 `{method:"event", params:{session_id, event: MaxmaEvent}}`（事件词表见 [ws-events.md](ws-events.md) §3.1）。

## 1. 会话核心

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `create_session` | `{ engine?, model, system_prompt?, append_system_prompt?, cwd?, tools? }` | `{ session_id }` | 建会话；权限模式映射为审批语义。**默认引擎已切 `pi`**（2026-09-30）；`MAXMA_AGENT_ENGINE=omp` 环境变量整体回退旧内核；显式 `engine` 参数优先级最高。pi 引擎支持参数与 RPC 矩阵见 §8 |
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

已知使用的键（Python 侧设置面板依赖）：`tools.approvalMode`、`compaction.enabled`、`compaction.strategy`、`compaction.thresholdPercent` 等——**替换时这些键的语义必须映射到新内核等价能力，键名对 Python 侧保持稳定或同步改 `api/routes/settings.py`**。

## 6. 插件与发现（阶段一处置：返回 unsupported + 前端 flag 隐藏）

`list_plugins` / `install_plugin` / `uninstall_plugin` / `set_plugin_enabled` / `get_plugin_detail` / `get_plugin_config` / `update_plugin_config` / `get_discovered_skills` / `get_discovered_extensions`

## 7. 工作流（已判定下线，迁移期保留定义）

`execute_workflow_step`：`{ session_id, step_definition: { step_id, tool, args } }` → `{ ok, step_id }`；发射 `workflow_step_start/end/error` 事件。

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
| `session_recap` / 插件与发现类 / `execute_workflow_step` / `headless_prompt` | ⏳ 未迁移 | 显式返回 `pi engine: method "..." not yet migrated` 错误（不允许静默黑洞） |

## 9. 已知不一致（替换期需对齐）

1. `rpc-types.ts` 的 `RpcMethodName` 联合缺 `set_plan_mode`、`checkpoint_action`、`goal_action`、`get_goal_state`、`session_recap`、`get_plugin_config`、`update_plugin_config`——dispatcher 已实现但类型滞后；以 `session-bridge.ts` dispatcher 为权威（32 个 handler）。
2. 插件/发现类 RPC 的参数/返回类型未在 `rpc-types.ts` 定义。
3. 阶段一约束：**RPC 面不变**（§1–3 必须逐方法等价实现）；§6 返回 unsupported；§7 随下线决策处理；pi 引擎支持矩阵见 §8。
