# Maxma Agent RPC 契约（Bun 后端 ↔ pi kernel）

> 契约源：`bun-sidecar/src/kernel/bridge-pi.ts`（权威实现）+ `kernel/pi-contract.ts` 的 `PI_RPC_METHODS`（方法名清单，由 `tests/pi-contract.test.ts` 与已安装引擎对账）。
> **本文不维护方法名副本**；§8 只记录语义与状态。改任一方法前先改本文与实现。
> 传输：**in-process 直接函数调用**，没有跨进程 JSON-RPC 层。后端 `server.ts` / `routes/sessions.ts` / `routes/chat-ws.ts` 直接 import `handlePiCreateSession` / `handlePiSessionRpc`。
> `session-bridge.ts` 的 stdio 入口**无运行时调用方**，仅 dev 入口与契约测试目标；其方法登记表消费 `PI_RPC_METHODS`。

## 1. 会话核心

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `create_session` | `{ model, provider?, base_url?, api_key?, provider_type?, context_window?, max_tokens?, system_prompt?, append_system_prompt?, cwd?, tools?, permission_mode?, thinking_level?, skills_enabled? }` | `{ session_id }` |
| `prompt` | `{ session_id, message }` | `{ ok: true }`，事件经订阅层推送 |
| `steer` / `follow_up` | `{ session_id, message }` | `{ ok, disposition? }`（活跃回合中立即注入 / 排队到回合结束） |
| `cancel` | `{ session_id }` | `{ ok: true }` |
| `destroy_session` | `{ session_id }` | `{ ok: true }` |
| `undo` | `{ session_id, steps? }` | `{ removed, turns_removed }` |
| `compact` | `{ session_id, keep_last? }` | 压缩结果 |
| `get_messages` / `clear_messages` | `{ session_id, limit? }` | `{ messages: [{role, content}], total }` |
| `get_health` | `{ session_id }` | 健康信息 |

引擎只有 `pi` 一个；`engine` 参数不再影响分流。

## 2. 审批与权限

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `user_response` | `{ session_id, interaction_id, response }` | 应答 `ask_user` |
| `set_auto_approve` | `{ session_id, auto_approve }` | `true`→`auto`，`false`→`ask`，运行时即时生效。**两态开关**：会把已选的 `read_only`/`operate` 改写掉，权限模式控件不许用它兜底 |
| `set_permission_mode` | `{ session_id, permission_mode }` | 档位任选，改运行中会话的 `record.permissionMode`（审批门按闭包读，即时生效）；非法档位 `io.sendError`。校验表与 REST 返回值同源：`pi-contract.ts` 的 `MAXMA_PERMISSION_MODES`。四档语义见 `dev_docs/permission-modes.md` |

REST 面（`bun-backend/src/routes/sessions.ts`）：`GET` / `PUT`
`/api/sessions/:sessionId/permission-mode` 回同一个形状
`{ session_id, permission_mode, available_permission_modes }`。
`available_permission_modes` 非空即代表可用（没有 feature flag，四档恒生效），前端据此渲染选项；
它的值是 `pi-contract.ts` 的 `MAXMA_PERMISSION_MODES`——kernel 入参校验、REST 返回值、
`MaxmaPermissionMode` 类型三者同源（`routes/sessions.ts` 运行时 import，先例同
`routes/capabilities.ts:29`），前端那份因边界纪律只能是副本，由测试逐字对账。
字段名与 `web/src/types/session.ts` 的 `SessionPermissionModeResponse` 由
`bun-backend/tests/permission-mode-contract.test.ts` 对账。`PUT` 非法档位 422，会话不存在 404。

## 3. 计划 / 目标 / 检查点 / 回顾

| 方法 | 说明 |
| --- | --- |
| `set_plan_mode` / `plan_action` | pi 无计划运行时，Maxma 自建：`followUp` 注入计划指令 + `submit_plan` 自定义工具提交审批；审批超时 10 分钟按拒绝 |
| `goal_action` / `get_goal_state` | 自建：官方 custom entry（`maxma:goal`）持久化 + `goal_updated` 事件 + `followUp` 注入目标提醒 |
| `checkpoint_action` | 官方 label/branch：save = `appendLabelChange`，restore = 找最近 label → `branch(targetId)`，无需 LLM 回合 |
| `session_recap` | `getLastAssistantText()` 捕获答案，30s 兜底返回空内容（前端对空回顾静默跳过） |

## 4. MCP / Settings / 工作流

| 方法 | 说明 |
| --- | --- |
| `reload_mcp_for_session` | 重连 MCP 并 `refreshMCPTools`；配置变更后必须调用或新建会话 |
| `get_settings` / `set_settings` | 点路径读写，键全集来自 `pi-contract.ts` 的 `MAXMA_SETTINGS_KEYS`；`consumer: "none"` 的键 PUT 返回 409 |
| `execute_workflow_step` | step 转 prompt 直调，事件经订阅层流给前端（产品面已下线，方法保留） |

## 5. 未实现（落 §8 兜底）

`headless_prompt`、插件与发现类（`list_plugins` / `install_plugin` / `uninstall_plugin` / `set_plugin_enabled` / `get_plugin_detail` / `get_plugin_config` / `update_plugin_config` / `get_discovered_skills` / `get_discovered_extensions`）、已被 per-session 版取代的 `reload_mcp`、`cancel_deferred_run`。

## 8. 语义要点

- `done` 由官方 `agent_settled` 触发；审批走官方 `tool_call` 钩子 + `ask_user`，**超时默认拒绝**。
- `undo` 是 append-only 分支语义：`branch(parentId)` / `resetLeaf()` 移动叶指针，条目不删除；`removed` = 离开上下文的条目数。
- `compact` 为官方摘要式压缩：消息不删除，`removed_count` 恒 0，摘要 tokens 在 detail。
- pi settings 树与上一代引擎键名不同（无 `compaction.thresholdPercent` 等），面板键需逐键对齐 `MAXMA_SETTINGS_KEYS`。
- Maxma 自定义工具经官方 `defineTool`（TypeBox `Type.Unsafe` 包装 plain JSON Schema）+ `customTools` 注入；实现在 `src/tools/*` descriptor（双端共用，零引擎 import）。清单见 `pi-contract.ts` 的 `MAXMA_CUSTOM_TOOLS`。
- MaxmaBlocker 挂官方 `tool_call` 钩子，`create_session` 恒装配；命中 block 单次调用并把原因回给 agent，整轮不中断。
- MCP：stdio + streamable_http 经 `createMcpExtension(loadConfig)` 注入；allow/block 映射官方 `exposure`/`toolExposure`；sse/websocket 不支持。

> **§8 的状态列请以现读 `bridge-pi.ts` 的 `if (method === "...")` 分支为准。** 本表曾把已实现的 `session_recap` / `execute_workflow_step` 标为"未迁移"近一个月，误导过一次解耦调查。

## 9. 已知不一致

1. `rpc-types.ts` 的 `RpcMethodName` 联合与 `bridge-pi.ts` 实现漂移：kernel 实际实现 23 个方法名（+ `create_session` 独立入口），部分已实现的方法未列入联合，部分列入联合的方法无分支（走 §5 兜底）。**权威是 `PI_RPC_METHODS` 与 `bridge-pi.ts`**，不是 `rpc-types.ts`。
2. 插件/发现类方法的参数与返回类型未在 `rpc-types.ts` 定义。
3. 阶段约束：§1–§3 的方法面保持稳定，新增对引擎名字的依赖必须先在 `pi-contract.ts` 登记。
