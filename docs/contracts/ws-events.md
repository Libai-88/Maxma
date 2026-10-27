# Maxma WS 事件契约（前端 ↔ 后端）

> 版本：v1（阶段〇基线；**版本握手已启用**——服务端首帧 `hello {protocol_version:1}` 见 `bun-backend/src/routes/chat-ws.ts:707`，前端识别于 `web/src/composables/useChat.ts:843`）
> 契约源：`bun-sidecar/src/rpc-types.ts`（`MaxmaEvent` 联合，§3.1 的权威 payload 定义）、`bun-sidecar/src/kernel/events.ts`（**pi 事件 → Maxma 事件的映射**，§3.1 词表的产生处）、`bun-backend/src/routes/chat-ws.ts`（WS 转发、回合富化与 §3.2 的后端合成事件）
> 消费方：`web/src/composables/useChat.ts` 及 `web/src/types/`
> 变更规则：本文档描述当前事实。修改任一事件前，先改本文档并同步 `rpc-types.ts`、`kernel/events.ts`、`chat-ws.ts`、`web/src/types/`，再动实现。
> ⚠️ 本文档的契约源曾指向 `api/ws_protocol.py` / `api/routes/chat.py`（Python 后端），**阶段二已整体移除 Python**，那些路径今天不存在。旧版正文里的 `chat.py:NNN` 行号引用一并作废，本文件已改为指认 Bun 侧实现；pi 原始事件名（`message_update` / `tool_execution_*` / `entry_appended` / `agent_settled` / `compaction_*`）只在 `kernel/events.ts` 出现，**不跨越 WS 边界**——前端看到的永远是本表词表。
> 与引擎相关的取值域（thinkingLevel、工具名、compaction reason 等）**单一数据源是 `bun-sidecar/src/kernel/pi-contract.ts`**，本文件不维护副本。

## 1. 传输

- 端点：`GET /ws/chat/{session_id}`（session_id 为 Maxma 会话 ID，非 sidecar 会话 ID）
- 鉴权：Token 放入 WebSocket subprotocol（前端经 `selectWebSocketProtocol` 取首个，见 `web/src/utils/wsProtocol.ts`）
- 帧格式：JSON 文本帧 `{ "type": string, "payload": object }`，双向同构

## 2. 客户端 → 服务端消息（WsMessageType）

### 2.1 服务端 → 客户端握手（连接建立即发，先于一切事件）

| type | payload | 说明 |
| --- | --- | --- |
| `hello` | `{ protocol_version: number }` | 服务端 accept 后首帧（`bun-backend/src/routes/chat-ws.ts:707`）。当前 `protocol_version = 1`；前端识别于 `web/src/composables/useChat.ts:843`（仅记日志，不转进事件路由）。原「阶段二双后端并行时协商」表述已作废——Python 后端已移除，不存在双后端并行 |

### 2.2 客户端消息

| type | payload | 处理 |
| --- | --- | --- |
| `ping` | — | 服务端回 pong（心跳） |
| `chat` | `{ message: string, ...附件字段 }` | 主对话入口：准备模型配置 → 建 sidecar session → `prompt` RPC → 事件流转发 |
| `cancel` | — | sidecar `cancel` RPC；后端补发 `done(cancelled=true)` 闭合前端状态机 |
| `user_response` | `{ interaction_id, response }` | 透传 sidecar `user_response` RPC（审批应答） |
| `update_auto_approve` | `{ auto_approve: boolean }` | 透传 `set_auto_approve` RPC（`chat-ws.ts:900-905`）。原「更新 Python 会话状态」已作废：Bun 侧不另存会话状态，权限模式由 kernel 的 approval-gate 持有 |
| `plan_response` | `{ plan_id, action, modified_plan? }` | 透传 `plan_action` RPC |
| `set_plan_mode` | `{ enabled: boolean }` | 透传 `set_plan_mode` RPC |
| `checkpoint_action` | `{ action: "save"\|"restore", goal? }` | 探活后透传 `checkpoint_action` RPC |
| `goal_action` | `{ action: "set"\|"replace"\|"pause"\|"resume"\|"drop", objective?, token_budget? }` | 探活后透传 `goal_action` RPC |
| `artifact_action` | 产物操作载荷 | 后端本地处理（读文件/操作），回 `artifact_result`；不经 sidecar |
| `steer` | `{ message: string }` | 活跃回合中立即注入调整；当前工具调用完成后由 Pi 处理 |
| `follow_up` | `{ message: string }` | 活跃回合中排入后续处理；当前回合结束后由 Pi 处理 |
| `task_review` | `{ action: "accept"\|"revise", feedback?: string }` | 回合完成后的验收；`revise` 会开启新的普通 `chat` 回合 |
| `task_brief_answer` | `{ answer: string }` | 需求澄清应答（`chat-ws.ts:807`）：答案入队，轮次 >4 转 `fallback` |
| `task_brief_execute` | `{ execution_prompt?: string, use_original?: boolean }` | 澄清结束后发起执行回合（`chat-ws.ts:822`）：走 `prompt` RPC，`use_original` 时用原始请求 |
| `task_brief_cancel` | — | 丢弃在途澄清状态（`chat-ws.ts:844`） |

> 这三类入站消息与此前的 `task_brief_update` 出站事件**均未收录进本契约的 v1 基线**（白名单实源 `chat-ws.ts:53-70`），2026-10-27 补登记。

处理位置：`bun-backend/src/routes/chat-ws.ts` —— 入站消息白名单 `CLIENT_MESSAGE_TYPES`（:53-70），分发在 `handleChatMessage`（:735 起）；出站方向的事件富化与后端合成在 `onKernelEvent` / `processKernelEvent`（:189-528），其余 kernel 事件经 :521-524 的 `default` 分支原样转发。

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
| `context_compressing` | `{ reason, action }` | 压缩开始。**`reason` 取值域 = `manual` \| `threshold` \| `overflow` \| `idle` \| `incomplete`**：前三者是 pi 实际会发的值（`pi-coding-agent` `dist/core/agent-session.d.ts:61` 的 `compaction_start.reason`），`idle` / `incomplete` 为上一代引擎（OMP）遗留、**当前引擎不产出**，保留仅为兼容历史转录与前端既有分支。`action` 在 pi 路径恒为 `context-full`（`handoff`/`shake`/`snapcompact` 属 OMP 遗留值，前端 `CompactionAction` 里的这三个分支今天不可达）。取值域的**单一数据源是 `kernel/pi-contract.ts` 的 `MAXMA_COMPACTION_REASONS_WS`**，`kernel/events.ts:64` 直接引用它、不再本地手抄。历史缺陷（已修，改动尚未提交）：此前 `events.ts` 手抄的白名单缺 `manual`，未知值被 `:222` 兜成 `threshold`——**用户手动压缩曾被静默误报成「阈值触发」** |
| `llm_usage` | `{ provider, model, usage, ... }` | 缓存预热/用量记账事件，由 `kernel/events.ts:184-201` 从 pi 的 `entry_appended`（`type==="usage" && kind==="cache_warm"`）映射产生，`chat-ws.ts:410` 落成本台账。**该事件此前漏出本表**（v1 基线时不存在）。注意它依赖的 `usage`/`label` 条目形状属"有文档、未从根 index 再导出"一类，登记在 `pi-contract.ts` 的 `PI_DUCK_TYPED_ENTRY_SHAPES`：`kind` 改名会让用量**静默不进账** |
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

### 3.2 后端合成 / 透传（发射端 `bun-backend/src/routes/chat-ws.ts`）

| type | payload 关键字段 | 发射端 |
| --- | --- | --- |
| `artifact` | 产物对象（路径/内容等，从写文件工具 `tool_end` 提取合成） | `chat-ws.ts:267` |
| `memory_start` / `memory_done` | `{ turn_id }` | `chat-ws.ts:624` / `:643`（`remember_memory` 工具回合的包装） |
| `memory_tool_start` / `memory_tool_end` / `memory_tool_error` | 工具事件载荷 | `chat-ws.ts:628` 起，同区间 |
| `sub_session_created` | 子会话信息 | **当前无发射方**——OMP 专有事件（`kernel/events.ts:13` 注释明确列为 OMP-only），pi 无子 Agent 导出；前端 `web/src/composables/useChat.ts:1049` 仍在消费该分支 |
| `deferred_subagent_submitted` | 透传 payload | **当前恒不触发**：转发/落库点在 `chat-ws.ts:483-517`，但 `bun-sidecar/src` 全目录 grep `deferred|subagent` **零命中**——引擎侧没有任何生产者，该事件与 `DeferredRunManager` 均为 OMP 时代遗留。登记处：`kernel/pi-contract.ts` 的 `ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED`。后果：`/agent-tasks` 任务中心读到的 `deferred_runs` 表在 pi 引擎下永远为空（唯一写库点就是上面那个 case）。入口处置见能力门控，勿据此认为"功能可用" |
| `plan_step_start` / `plan_step_end` / `plan_step_error` | 步骤载荷 | **当前无发射方**——同 `sub_session_created`，OMP 专有；前端 `useChat.ts:1680` 仍保留分支 |
| `workflow_step_start` / `workflow_step_end` / `workflow_step_error` / `workflow_completed` | `{ step_id, tool_name, status?, error? }` | `bun-backend/src/routes/workflows.ts:178`（`EV_STEP_START` 等常量）执行引擎推送 |
| `collaboration_update` | `{ status: "queued"\|"error", mode: "steer"\|"follow_up", message }` | `chat-ws.ts:883` / `:886`（实时协作入队或失败回执） |
| `task_review_update` | `{ status: "available"\|"accepted"\|"revising", turn_id, answer?, message? }` | `chat-ws.ts:616` / `:860`（回合完成后的验收状态；有最终回答且未取消时发出 `available`） |
| `task_brief_update` | `{ turn_id, status: "thinking"\|"clarify"\|"ready"\|"fallback", questions?, execution_prompt?, error? }` | `chat-ws.ts:157` / `:165` / `:170` / `:815`（需求澄清状态机）。**此前漏出本表**，前端类型见 `web/src/types/index.ts:476` |

## 4. 已知不一致（替换期需对齐）

1. `rpc-types.ts` 的 `MaxmaEvent` 未覆盖 3.2 中由后端合成/透传的事件——这些事件的 payload 定义散落在 `bun-backend/src/routes/chat-ws.ts`，契约完整度以后端代码为准。
2. `WsEventType.CONTEXT_USAGE`、`TOOL_START` 等在枚举中存在但发射频率/路径需以实现为准（`context_usage` 独立事件 sidecar 从不发射）。
3. 协议握手已实现（§2.1，`protocol_version = 1`）；快照测试已入库（`bun-sidecar/tests/contract-snapshot.test.ts` + `tests/__snapshots__/`，25 个 golden 快照覆盖 pi 事件映射全词表、pi RPC 回复形状、ask_user payload）——**任何映射/形状变更必须显式更新快照并核对契约文档**。⚠️ 该快照喂的是**手写的合成 pi 事件对象**，因此它能锁住"我方映射不回归"，**测不出上游改名/删除事件**——pi 换代时快照照样全绿。引擎侧对账请用 `kernel/pi-contract.ts` 的守卫测试（对照已安装的 pi 包现读，范式对齐 `bun-backend/tests/plugins/jet-hub-coverage.test.ts`）。
4. **本表存在三个"前端仍在消费、但已无人发射"的 OMP 专有事件**：`sub_session_created`、`plan_step_start/end/error`、`deferred_subagent_submitted`（判据与登记见 §3.2 各行与 `pi-contract.ts`）。它们不是文档笔误，而是上一代引擎换代之后的**静默断链**：类型仍在 `web/src/types/`、分支仍在 `useChat.ts`、快照仍全绿、页面照得开，只是永远不会再来。修改本表时请勿把它们当作可用能力引用。
