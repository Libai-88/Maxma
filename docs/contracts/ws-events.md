# Maxma WS 事件契约（前端 ↔ 后端）

> 契约源：`bun-sidecar/src/kernel/events.ts`（**pi 事件 → Maxma 事件的映射，§3.1 词表的产生处**）、`bun-backend/src/routes/chat-ws.ts`（入站白名单、转发、回合富化、§3.2 后端合成事件）、`bun-sidecar/src/rpc-types.ts`（payload 类型，滞后项见 §4）
> 消费方：`web/src/composables/useChat.ts`、`web/src/types/`
> 与引擎相关的取值域（thinkingLevel、工具名、compaction reason 等）**单一数据源是 `kernel/pi-contract.ts`**，本文不维护副本。
> 下行事件按"谁负责产出"登记在 `kernel/pi-contract.ts` 的三张清单里：`MAXMA_ENGINE_WS_EVENTS`
> （引擎/kernel 产出）、`ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED`（**前一张的例外区**：契约还声明着、
> 引擎换代后没人产出了，所以一条事件同时在这两张里是有意的）、`BACKEND_SYNTHESIZED_EVENTS`
> （后端路由自己合成，见 §3.2；与前两张互斥）。三张表由 `bun-sidecar/tests/engine-boundary.test.ts`
> 与 kernel + `bun-backend/src` 的**全部**发射点双向对账。
> pi 原始事件名（`message_update` / `tool_execution_*` / `entry_appended` / `agent_settled` / `compaction_*`）只在 `events.ts` 出现，**不跨越 WS 边界**。

## 1. 传输

- 端点 `/ws/chat/{session_id}`（Maxma 会话 ID，非 kernel 会话 ID）
- 鉴权：Token 放 WS subprotocol（`web/src/utils/wsProtocol.ts` 取首个），回退 header/query；失败 close 4001
- 帧格式：JSON 文本帧 `{ "type": string, "payload": object }`，双向同构
- 握手：服务端 accept 后首帧 `hello { protocol_version: 1 }`（`chat-ws.ts`），前端仅记日志、不进事件路由

## 2. 客户端 → 服务端

入站白名单的**权威是 `chat-ws.ts` 的 `CLIENT_MESSAGE_TYPES`**（16 项），分发在 `handleChatMessage`：

`ping` · `chat` · `cancel` · `user_response` · `update_auto_approve` · `plan_response` · `set_plan_mode` · `checkpoint_action` · `goal_action` · `artifact_action` · `steer` · `follow_up` · `task_review` · `task_brief_answer` · `task_brief_execute` · `task_brief_cancel`

要点：`chat` 携带 `message, turn_id, client_msg_id, private, auto_approve, provider_id, model_name, temperature, max_tokens, thinking, task_brief?, think_path_id?`；`client_msg_id` 做幂等去重；同会话单连接持有 turn（其他连接发 `chat` → `BUSY` error）；断开不销毁会话。

前端 `web/src/types/index.ts` 的 `ClientMessage` 联合现已**覆盖这 16 项**（此前只覆盖 6 项，
其余 10 项以无类型字面量发出），发送统一经 `useChat.ts` 的 `sendClientMessage` 收口点；
两侧一致性由 `web/tests/wsEventSink.spec.ts` 与白名单逐字对账。

## 3. 服务端 → 客户端

### 3.1 引擎产出（经 `events.ts` 映射）

| type | payload 关键字段 |
| --- | --- |
| `thinking_start` / `thinking_delta` / `thinking_end` | `{}` / `{ delta }` / `{ content }` |
| `token` | `{ token }` 正文增量 |
| `tool_start` / `tool_update` / `tool_end` / `tool_error` | `{ tool_name, input }` / `{ partial_result }` / `{ output, elapsed, tool_data? }` / `{ error, elapsed }` |
| `answer` | `{ content }` 最终回答全文 |
| `done` | `{ turn_id?, context_usage?, cancelled? }`；`cancelled=true` 为取消补发；`context_usage` 是用量到达前端的唯一常规路径 |
| `error` | `{ code, message, trace_id?, category? }` |
| `ask_user` | `{ tool_name, question, mode: "approval", options, interaction_id, detail?, risk_level?, tool_input? }` |
| `context_compressing` / `context_compressed` | `{ reason, action }` / `{ summary_preview?, before_tokens?, skipped?, aborted?, will_retry?, error_message? }` |
| `retry_start` / `retry_end` | `{ attempt, max_attempts, delay_ms, error_message }` / `{ success, attempt, final_error? }` |
| `notice` | `{ level, message, source? }` |
| `plan_proposed` / `plan_completed` | `{ plan_id, steps, plan_text }` / `{ summary: { total_steps } }` |
| `goal_updated` | `{ goal, state }` |
| `llm_usage` | `{ provider, model, usage, … }` 用量记账；由 `entry_appended`（`type==="usage" && kind==="cache_warm"`）映射。**但它是服务端内部事件，不下发前端**：`chat-ws.ts:410-476` 每条路径都 `return`，只落成本台账与 metrics。列在此处是因为它确实经 `events.ts` 进入后端事件流；前端 `ServerEvent` 联合里**没有**它，也不该加。该映射依赖的条目形状登记在 `PI_DUCK_TYPED_ENTRY_SHAPES`：`kind` 改名会让用量**静默不进账** |

`context_compressing.reason` 取值域 = `MAXMA_COMPACTION_REASONS_WS`（`manual` / `threshold` / `overflow` 为引擎真实值；`idle` / `incomplete` 为上一代引擎遗留、当前引擎不产出，保留仅为兼容历史转录与前端既有分支）。`action` 在 pi 路径恒为 `context-full`。

两侧类型都**不许重抄这份词表**：`rpc-types.ts` 的 `MaxmaCompactionReason` 与
`web/src/types/index.ts` 的 `CompactionReason` 都由该清单派生/对账。`events.ts` 的钳位白名单
同样取自它——历史上这两处各抄一份、都漏了 `manual`，于是"用户手动压缩"在 UI 上被静默
报成"阈值触发"。

### 3.2 后端合成 / 透传（发射端 `chat-ws.ts`，工作流族为 `routes/workflows.ts`）

| type | 说明 |
| --- | --- |
| `artifact` | 从写类工具 `tool_end` 提取路径合成（`routes/chat-artifacts.ts`） |
| `memory_start` / `memory_tool_start` / `memory_tool_end` / `memory_tool_error` / `memory_done` | `remember_memory` 工具回合的包装 |
| `collaboration_update` | `{ status: "queued"\|"error", mode: "steer"\|"follow_up", message }` 实时协作回执 |
| `task_review_update` | `{ status: "available"\|"accepted"\|"revising", turn_id, answer?, message? }` 回合验收状态 |
| `task_brief_update` | `{ turn_id, status: "thinking"\|"clarify"\|"ready"\|"fallback", questions?, execution_prompt?, error? }` 需求澄清状态机 |
| `workflow_step_start` / `workflow_step_end` / `workflow_step_error` | 工作流逐步进度；`routes/workflows.ts` 每步都发。kernel 也声明了这三个（`bridge-pi.ts` 的 `execute_workflow_step`），但那条分支目前没人调用 → 见 §4 第 4 条 |
| `workflow_completed` | 整条工作流跑完/失败/被取消的收尾事件，**只有 `routes/workflows.ts` 一个生产者**（kernel 不发），经 `server.ts` 注入的 sink 直连广播 |

登记归属分两张表，由 `bun-sidecar/tests/engine-boundary.test.ts` 与全部后端发射点**双向**对账
（后端发得出却没任何清单认领 → 红；清单登记了却查不到发射点 → 也红；同一条事件既被说成
"后端合成"又被说成"引擎产出/引擎不产出" → 也红）。发射点扫描覆盖 `bun-backend/src`
**整个目录**，不止 `chat-ws.ts`：

- `BACKEND_SYNTHESIZED_EVENTS`：`hello` / `pong` / `artifact` / `artifact_result` /
  `collaboration_update` / `memory_*` / `task_brief_update` / `task_review_update` /
  **`workflow_completed`**（只有 `routes/workflows.ts` 一个生产者，kernel 不发）。
- `MAXMA_ENGINE_WS_EVENTS`：`workflow_step_start` / `workflow_step_end` /
  `workflow_step_error`——这三个 kernel 里真有生产者（`bridge-pi.ts` 的
  `execute_workflow_step`），所以归"引擎产出"，不许为了少写一条对账而塞进后端合成表。

活动埋点的 `event_type`（`recordActivity("turn", "turn_start", …)`，见 `activity-hub.ts`）与
**入站**客户端消息类型（`task_review`，出站那个叫 `task_review_update`）都不算下行 WS 事件，
不得登记进任何一张表——两个都曾被当成"后端合成事件"登记过，那是给对账测试开的永不命中的口子。

### 3.3 协议保留但**当前无人发射**

登记在 `pi-contract.ts` 的 `ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED`，由 `tests/engine-boundary.test.ts` 双向校验（声明为引擎产出却查不到生产者 → 红；登记为不产出却查出生产者 → 也红）：

`deferred_subagent_submitted` · `sub_session_created` · `irc_message` · `todo_reminder` · `context_usage` · `plan_step_start` · `plan_step_end` · `plan_step_error`

**这些不是文档笔误，而是上一代引擎换代之后的静默断链**：类型仍在 `web/src/types/`、分支仍在 `useChat.ts`、快照仍全绿、页面照得开，只是永远不会再来。勿据以认为功能可用。

`workflow_completed` 不在这里——它有人发，只是发的人不是引擎。

## 4. 已知不一致

1. `rpc-types.ts` 的 `MaxmaEvent` 未覆盖 §3.2 的后端合成事件；这些 payload 定义散落在 `chat-ws.ts` / `workflows.ts`，契约完整度以后端代码为准。
2. 后端从 `workflows.ts` 广播 `workflow_step_*` / `workflow_completed`，但前端**没有任何工作流消费者**（无 UI、`api/index.ts` 无对应方法）。这四个类型已从 `ServerEvent` 联合删除，属"按设计不存在"；若将来真的下发而前端未接，会命中入口守卫与 `default` 分支各打一次 dev 可见告警，不再静默。
3. 快照测试 `bun-sidecar/tests/contract-snapshot.test.ts` 喂的是**手写合成 pi 事件**，只锁"我方映射不回归"，**测不出上游改名/删除事件**。引擎侧对账请用 `pi-contract.test.ts` + `engine-boundary.test.ts`。任何映射/形状变更必须显式更新快照并核对本文。
4. `workflow_step_*` 登记为"引擎产出"（kernel `execute_workflow_step` 分支确实发这三种事件），但 `server.ts:230` 是 `createWorkflowRoutes()` **空 deps** 挂载，`WorkflowDeps.executeViaKernel` 恒为 `undefined`，于是 `workflows.ts:244` 的 sidecar 分支永远不走：`mode: "sidecar"` 的定义会落进 `executeSimpleStep()` 并因 `Unsupported workflow tool` 失败。也就是说这三种事件**当前唯一真实的发射方是后端路由自己**，kernel 那条分支只剩直接调 RPC 才够得着。接上执行侧需要给 `createWorkflowRoutes` 注入 `executeViaKernel`（属功能改动，不在本次类型/登记表收口的边界内）。

已修（原先记在这里，别再当开放项）：

- `rpc-types.ts` 的 `context_compressing.payload.reason` 曾手抄一份缺 `manual` 的字面量联合，
  现改为从 `MAXMA_COMPACTION_REASONS_WS` 派生（`MaxmaCompactionReason`），由
  `pi-contract.test.ts` 锁死派生形状 + `engine-boundary.test.ts` 与前端联合逐字对账。
- `workflow_completed` 曾三张清单一张都不在（旧对账判据只正则扫 `chat-ws.ts`，
  从 `workflows.ts` 发出去的事件天然隐形），现登记进 `BACKEND_SYNTHESIZED_EVENTS`，
  并且判据已扩到整个 `bun-backend/src`。
- `useChat.ts` 的事件 `switch` 曾**没有 `default` 分支**，声明而未处理的入站类型被静默丢弃；
  现有入口守卫 + `default` 告警 + `SERVER_EVENT_HANDLER_TYPES` 编译期登记表三重叠，
  由 `web/tests/wsEventSink.spec.ts`（含变异用例）锁死：往 `ServerEvent` 联合加类型而不加
  `case`，会直接编译不过/测试红。
- 曾宣称 `llm_usage` 是"前端漏接"的事件——核实后它**从来不在**前端 `ServerEvent` 联合里，
  且 `chat-ws.ts:410-476` 每条路径都 `return`，永不转发；§3.1 把它列在"服务端→客户端"表内
  是本文档自己的措辞错误，已改注为服务端内部事件。
