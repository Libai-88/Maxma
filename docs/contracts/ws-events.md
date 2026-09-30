# Maxma WS 事件契约（前端 ↔ 后端）

> 版本：v1（阶段〇基线，尚未启用版本握手）
> 契约源：`api/ws_protocol.py`（枚举）、`bun-sidecar/src/rpc-types.ts`（MaxmaEvent 联合）、`api/routes/chat.py`（转发与合成）
> 变更规则：本文档描述当前事实。修改任一事件前，先改本文档并同步 `ws_protocol.py`、`rpc-types.ts`、`web/src/types/` 三处，再动实现。
> 消费方：`web/src/composables/useChat.ts` 及 `web/src/types/`

## 1. 传输

- 端点：`GET /ws/chat/{session_id}`（session_id 为 Maxma 会话 ID，非 sidecar 会话 ID）
- 鉴权：Token 放入 WebSocket subprotocol（前端经 `selectWebSocketProtocol` 取首个，见 `web/src/utils/wsProtocol.ts`）
- 帧格式：JSON 文本帧 `{ "type": string, "payload": object }`，双向同构

## 2. 客户端 → 服务端消息（WsMessageType）

### 2.1 服务端 → 客户端握手（连接建立即发，先于一切事件）

| type | payload | 说明 |
| --- | --- | --- |
| `hello` | `{ protocol_version: number }` | 服务端 accept 后首帧（`chat.py` websocket_chat 入口）。当前 `protocol_version = 1`。客户端识别后不得转发进事件路由；未知版本的处理在阶段二双后端并行时协商 |

### 2.2 客户端消息

| type | payload | 处理 |
| --- | --- | --- |
| `ping` | — | 服务端回 pong（心跳） |
| `chat` | `{ message: string, ...附件字段 }` | 主对话入口：准备模型配置 → 建 sidecar session → `prompt` RPC → 事件流转发 |
| `cancel` | — | sidecar `cancel` RPC；后端补发 `done(cancelled=true)` 闭合前端状态机 |
| `user_response` | `{ interaction_id, response }` | 透传 sidecar `user_response` RPC（审批应答） |
| `update_auto_approve` | `{ auto_approve: boolean }` | 更新 Python 会话状态 + 透传 `set_auto_approve` RPC |
| `plan_response` | `{ plan_id, action, modified_plan? }` | 透传 `plan_action` RPC |
| `set_plan_mode` | `{ enabled: boolean }` | 透传 `set_plan_mode` RPC |
| `checkpoint_action` | `{ action: "save"\|"restore", goal? }` | 探活后透传 `checkpoint_action` RPC |
| `goal_action` | `{ action: "set"\|"replace"\|"pause"\|"resume"\|"drop", objective?, token_budget? }` | 探活后透传 `goal_action` RPC |
| `artifact_action` | 产物操作载荷 | 后端本地处理（读文件/操作），回 `artifact_result`；不经 sidecar |

处理位置：`api/routes/chat.py` 1163–1440 区间分支。

## 3. 服务端 → 客户端事件（WsEventType）

### 3.1 sidecar 发射（`MaxmaEvent` 联合，`rpc-types.ts` 为权威 payload 定义）

| type | payload 关键字段 | 说明 |
| --- | --- | --- |
| `thinking_start` | `{}` | 思考流开始 |
| `thinking_delta` | `{ delta: string }` | 思考增量 |
| `thinking_end` | `{ content: string }` | 思考结束（全文） |
| `token` | `{ token: string }` | 正文增量 |
| `tool_start` | `{ tool_name, input }` | 工具调用开始（input 为序列化参数） |
| `tool_update` | `{ tool_name, partial_result }` | 工具执行中间输出 |
| `tool_end` | `{ tool_name, output, elapsed, tool_data? }` | 工具完成；后端在写文件工具时据此合成 `artifact` |
| `tool_error` | `{ tool_name, error, elapsed }` | 工具失败 |
| `answer` | `{ content: string }` | 最终回答全文 |
| `done` | `{ turn_id?, context_usage?, cancelled? }` | 回合结束；`cancelled=true` 为取消补发；`context_usage` 是用量到达前端的唯一常规路径 |
| `error` | `{ code, message, trace_id?, category? }` | 错误；trace_id/category 由后端按 code 映射补充 |
| `ask_user` | `{ tool_name, question, mode: "approval", options, interaction_id, detail?, risk_level?, tool_input? }` | 审批请求；`risk_level`/`tool_input` 由 sidecar 解析补充 |
| `context_compressing` | `{ reason, action }` | 压缩开始 |
| `context_compressed` | `{ summary_preview?, before_tokens?, action?, skipped?, aborted?, will_retry?, error_message? }` | 压缩结束 |
| `retry_start` | `{ attempt, max_attempts, delay_ms, error_message }` | 自动重试开始 |
| `retry_end` | `{ success, attempt, final_error? }` | 自动重试结束 |
| `todo_reminder` | `{ todos, attempt, max_attempts }` | 待办提醒 |
| `irc_message` | `{ from, to, body, id }` | 多 Agent IRC 消息 |
| `notice` | `{ level: "info"\|"warning"\|"error", message, source? }` | 通知 |
| `plan_proposed` | `{ plan_id, steps, plan_text }` | 计划提案（前端 PlanCard 审批） |
| `plan_completed` | `{ summary: { total_steps } }` | 计划批准完成 |
| `goal_updated` | `{ goal, state }` | 目标模式状态变化（可为 null） |
| `context_usage` | `Record<string, unknown>` | 独立用量事件（sidecar 实际不发射，仅协议保留；常规路径为 `done.payload.context_usage`） |

### 3.2 后端合成 / 透传（发射端 `api/routes/chat.py`）

| type | payload 关键字段 | 发射端 |
| --- | --- | --- |
| `artifact` | 产物对象（路径/内容等，chat.py 从写文件工具 `tool_end` 提取合成） | chat.py:539 |
| `memory_start` / `memory_done` | `{ turn_id }` | chat.py:1077–1094（`remember_memory` 工具回合的包装） |
| `memory_tool_start` / `memory_tool_end` / `memory_tool_error` | 工具事件载荷 | chat.py 同上区间 |
| `sub_session_created` | 子会话信息 | sidecar 发射 → chat.py:708 白名单透传 |
| `deferred_subagent_submitted` | 透传 payload | chat.py:686 |
| `plan_step_start` / `plan_step_end` / `plan_step_error` | 步骤载荷 | sidecar 发射 → chat.py 白名单透传 |
| `workflow_step_start` / `workflow_step_end` / `workflow_step_error` / `workflow_completed` | `{ step_id, tool_name, status?, error? }` | `api/routes/workflows.py` 执行引擎推送 |

## 4. 已知不一致（替换期需对齐）

1. `rpc-types.ts` 的 `MaxmaEvent` 未覆盖 3.2 中由后端合成/透传的事件——这些事件的 payload 定义散落在 `chat.py`，契约完整度以后端代码为准。
2. `WsEventType.CONTEXT_USAGE`、`TOOL_START` 等在枚举中存在但发射频率/路径需以实现为准（`context_usage` 独立事件 sidecar 从不发射）。
3. 协议握手已实现（§2.1，`protocol_version = 1`）；快照测试已入库（`bun-sidecar/tests/contract-snapshot.test.ts` + `tests/__snapshots__/`，25 个 golden 快照覆盖 pi 事件映射全词表、pi RPC 回复形状、ask_user payload）——**任何映射/形状变更必须显式更新快照并核对契约文档**。
