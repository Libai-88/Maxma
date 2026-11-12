# Maxma WS 事件契约（前端 ↔ 后端）

> 契约源：`bun-sidecar/src/kernel/events.ts`（**pi 事件 → Maxma 事件的映射，§3.1 词表的产生处**）、`bun-backend/src/routes/chat-ws.ts`（入站白名单、转发、回合富化、§3.2 后端合成事件）、`bun-sidecar/src/rpc-types.ts`（payload 类型，滞后项见 §4）
> 消费方：`web/src/hooks/useChat.ts`、`web/src/types/`
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
前端登记由 `SERVER_EVENT_HANDLER_TYPES`（`Record<ServerEvent['type'], true>`）在 **编译期** 强制：向 `ServerEvent` 联合加成员而不登记，`tsc` 报 missing property。

## 3. 服务端 → 客户端

### 3.1 引擎产出（多数经 `events.ts` 映射；`permission_mode_updated` 由 `bridge-pi.ts` 的写入点直接广播）

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
| `permission_mode_updated` | `{ permission_mode }` **不由 `events.ts` 映射**，而是 `bridge-pi.ts` 的 `writePermissionMode` 直发：内核每次真正写 `record.permissionMode`（四档 `set_permission_mode`／两态 `set_auto_approve` 两条路径）都广播一次；档位取值域 = `MAXMA_PERMISSION_MODES`，被拒的写入不发。前端「自动执行」开关与权限选择器都以这条为收敛点（PERM-ANNOUNCE-001） |
| `llm_usage` | `{ kind: "model_request" \| "cache_warm", usage: { input, output, cacheRead, cacheWrite } \| null, provider, model, request_duration_ms, price_status, cache_status, turn_id? }`。**先落成本台账/metrics，再回执前端**（`forwardLlmUsage`）：只发 UI 需要的字段，`turn_id` 用来归属当前轮。`cache_status` 由 cacheRead/cacheWrite 现场派生（payload 常常只给两个数字）。两种来源：`bridge-pi.ts` 的 `message_end` 派生 `model_request`、`entry_appended`（`type==="usage" && kind==="cache_warm"`）派生 `cache_warm`。该映射依赖的条目形状登记在 `PI_DUCK_TYPED_ENTRY_SHAPES`：`kind` 改名会让用量**静默不进账** |
| `answer`（回合终态补发） | `{ turn_id, content, model?, provider? }`。`finishTurn` 在 `done` 前补发一次完整回答；`model/provider` 是**实际**产出这句话的模型（fallback 池里未必是会话默认模型），客户端据此渲染用量脚注 |

`context_compressing.reason` 取值域 = `MAXMA_COMPACTION_REASONS_WS`（`manual` / `threshold` / `overflow` 为引擎真实值；`idle` / `incomplete` 为上一代引擎遗留、当前引擎不产出，保留仅为兼容历史转录与前端既有分支）。`action` 在 pi 路径恒为 `context-full`。

两侧类型都**不许重抄这份词表**：`rpc-types.ts` 的 `MaxmaCompactionReason` 与
`web/src/types/index.ts` 的 `CompactionReason` 都由该清单派生/对账。`events.ts` 的钳位白名单
同样取自它——历史上这两处各抄一份、都漏了 `manual`，于是"用户手动压缩"在 UI 上被静默
报成"阈值触发"。

### 3.2 后端合成 / 透传（发射端 `chat-ws.ts`）

| type | 说明 |
| --- | --- |
| `artifact` | 从写类工具 `tool_end` 提取路径合成（`routes/chat-artifacts.ts`） |
| `memory_start` / `memory_tool_start` / `memory_tool_end` / `memory_tool_error` / `memory_done` | `remember_memory` 工具回合的包装 |
| `collaboration_update` | `{ status: "queued"\|"error", mode: "steer"\|"follow_up", message }` 实时协作回执 |
| `action_failed` | `{ action, message }` 会话级动作（`user_response` / `update_auto_approve` / `plan_action` / `set_plan_mode` / `checkpoint_action`）的 RPC **失败**回执，前端 toast 呈现（ACTION-FAIL-001）。成功路径各有回执（`permission_mode_updated` / `goal_updated` / `artifact_result`），不重复广播；`cancel` 类有意不走（本地记录即真相） |
| `task_review_update` | `{ status: "available"\|"accepted"\|"revising", turn_id, answer?, message? }` 回合验收状态 |
| `task_brief_update` | `{ turn_id, status: "thinking"\|"clarify"\|"ready"\|"fallback", questions?, execution_prompt?, error? }` 需求澄清状态机 |

登记归属分两张表，由 `bun-sidecar/tests/engine-boundary.test.ts` 与全部后端发射点**双向**对账
（后端发得出却没任何清单认领 → 红；清单登记了却查不到发射点 → 也红；同一条事件既被说成
"后端合成"又被说成"引擎产出/引擎不产出" → 也红）。发射点扫描覆盖 `bun-backend/src`
**整个目录**，不止 `chat-ws.ts`——这条纪律的由来正是 `routes/workflows.ts`：它经 `server.ts`
注入的 sink 广播，对只扫单文件的旧判据完全隐形。那条死面 2026-11-02 已整体删除（见 §4 已修），
现存的发射点因此全在 `chat-ws.ts` 里；**跨文件发现能力由临时 fixture 自证**
（`engine-boundary.test.ts` 造一个"路由 + 常量名 sink"的临时文件喂给扫描器），
所以将来新增第二条后端发射链，照样会被这条判据抓到，不必等它先漂出一次事故。

- `BACKEND_SYNTHESIZED_EVENTS`：`hello` / `pong` / `artifact` / `artifact_result` /
  `collaboration_update` / `action_failed` / `memory_*` / `task_brief_update` / `task_review_update`。
- `MAXMA_ENGINE_WS_EVENTS`（本节只列 §3.1 之外的补充说明）：kernel 产出的事件一律归这张表，
  不许为了少写一条对账而塞进后端合成表——`permission_mode_updated` 就是按这条登记的
  （生产者在 `bridge-pi.ts`，REST/WS 层只是转发）。

活动埋点的 `event_type`（`recordActivity("turn", "turn_start", …)`，见 `activity-hub.ts`）与
**入站**客户端消息类型（`task_review`，出站那个叫 `task_review_update`）都不算下行 WS 事件，
不得登记进任何一张表——两个都曾被当成"后端合成事件"登记过，那是给对账测试开的永不命中的口子。

### 3.3 协议保留但**当前无人发射**

登记在 `pi-contract.ts` 的 `ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED`，由 `tests/engine-boundary.test.ts` 双向校验（声明为引擎产出却查不到生产者 → 红；登记为不产出却查出生产者 → 也红）：

`deferred_subagent_submitted` · `sub_session_created` · `irc_message` · `todo_reminder` · `context_usage` · `plan_step_start` · `plan_step_end` · `plan_step_error`

**这些不是文档笔误，而是上一代引擎换代之后的静默断链**：类型仍在 `web/src/types/`、分支仍在 `useChat.ts`、快照仍全绿、页面照得开，只是永远不会再来。勿据以认为功能可用。

工作流族四个事件（`workflow_step_*` / `workflow_completed`）也不在这里——它们随整条
死的 REST 工作流面在 2026-11-02 被删除，三侧源码与三张清单都不该再认识它们
（由 `engine-boundary.test.ts` 的"干净切换锁"扫源码对账）。

## 4. 已知不一致

1. `rpc-types.ts` 的 `MaxmaEvent` 未覆盖 §3.2 的后端合成事件；这些 payload 定义散落在
   `chat-ws.ts`，契约完整度以后端代码为准。
2. 快照测试 `bun-sidecar/tests/contract-snapshot.test.ts` 喂的是**手写合成 pi 事件**，只锁"我方映射不回归"，**测不出上游改名/删除事件**。引擎侧对账请用 `pi-contract.test.ts` + `engine-boundary.test.ts`。任何映射/形状变更必须显式更新快照并核对本文。

工作流族已从本节移除（原先第 2、4 条描述的就是它）：那条 REST 工作流面在 2026-11-02
**整体删除**，不是"待接通"。删除前的形状是——`server.ts` 用**空 deps** 挂
`createWorkflowRoutes()`，`WorkflowDeps.executeViaKernel` 恒为 `undefined`，于是
`workflows.ts` 的 sidecar 分支永远不走，`mode: "sidecar"` 的定义落进 `executeSimpleStep()`
并因 `Unsupported workflow tool` 失败：REST 面只能报失败，kernel 的 `execute_workflow_step`
分支只剩直接调 RPC 才够得着，而前端从来没有工作流消费者。恢复自动化 = 一个全新工作项
（定义来源、执行侧、UI 消费者都得重新设计），不要试图"接回"这条链。

已修（原先记在这里，别再当开放项）：

- `rpc-types.ts` 的 `context_compressing.payload.reason` 曾手抄一份缺 `manual` 的字面量联合，
  现改为从 `MAXMA_COMPACTION_REASONS_WS` 派生（`MaxmaCompactionReason`），由
  `pi-contract.test.ts` 锁死派生形状 + `engine-boundary.test.ts` 与前端联合逐字对账。
- 工作流族事件（`workflow_step_*` / `workflow_completed`）与 `routes/workflows.ts`、
  kernel 的 `execute_workflow_step`、前端 `types/workflow.ts`、打包里的 `workflows/` 目录
  一起在 2026-11-02 删除；`workflow_completed` 曾三张清单一张都不在（旧对账判据只正则扫
  `chat-ws.ts`），那段登记随代码一起撤掉，判据本身仍覆盖整个 `bun-backend/src`。
- `useChat.ts` 的事件 `switch` 曾**没有 `default` 分支**，声明而未处理的入站类型被静默丢弃；
  现有入口守卫 + `default` 告警 + `SERVER_EVENT_HANDLER_TYPES` 编译期登记表三重叠，
  由编译期登记锁死：往 `ServerEvent` 联合加类型而不加
  `case`，会直接编译不过/测试红。
- `llm_usage` 曾按"服务端内部事件"处理（每条路径都 `return`，只落库）。2026-11-12 复查推翻了
  这个决定：它让对话里完全看不到"这一轮用了多少 token、走的哪个模型、缓存命中没有"——指标页
  只有聚合，逐次请求的记录只能翻数据库。现在改为**落库后转发一条精简帧**，前端
  `TurnUsage`（`useChat.ts` 的 `llm_usage` 分支）+ 回答下方脚注消费；`cache_warm` 单独计数，
  不进命中率。落库与展示是两件事，记账不能替代回执。
