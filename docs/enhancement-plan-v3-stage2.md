# MaxmaHere 阶段 2 实施计划：Plan-and-execute 重构 + HITL 链路修复

> **版本**：v3-stage2
> **创建时间**：2026-07-04
> **目标**：让 Plan-and-execute 真正落地（executor 节点 + 步骤状态机 + 并行规划接入 + 失败重规划），打通 PlanCard 前后端 HITL 链路
> **前置依赖**：阶段 1 完成（特别是 1.7 工具注册去中心化，降低 build_agent 调用面变更冲突）
> **追踪方式**：每个任务含「相关文件」「改动类型」「预期改动点」「状态」四字段，开发时按文件路径定位即可

---

## 总览

| 子任务 | 名称 | 优先级 | 涉及文件数 | 新建文件数 |
|---|---|---|---|---|
| 2.1 | executor 节点 + 步骤状态机 | P0 | 11 | 4 |
| 2.2 | 接入 extract_parallel_groups，基于 plan 触发 parallel_execute | P0 | 5 | 0 |
| 2.3 | 失败重规划机制（接入死代码 error_recovery） | P0 | 6 | 0 |
| 2.4 | 打通 planner 阈值触发 HITL 确认链路 | P0 | 8 | 0 |

---

## 关键背景发现（影响设计）

1. **AgentState 当前极简**：[agent/graph.py](file:///d:/Maxma/MaxmaHere/agent/graph.py) L113-115 的 `AgentState` 仅含 `messages` 字段，无步骤状态机字段。`docs/02-LangGraph状态图与状态管理.md` 描述的 `agent/state.py` + `remaining_steps` 已过时，与实际代码不符
2. **error_recovery 完全未接入**：[agent/error_recovery.py](file:///d:/Maxma/MaxmaHere/agent/error_recovery.py) 的 `ErrorRecoveryManager` / `retry_network_call` 在 `api/`、`agent/`（除自身）中无任何 import/调用（grep 0 命中），是"已写好但未接线"的死代码
3. **extract_parallel_groups 未被调用**：[agent/planner.py](file:///d:/Maxma/MaxmaHere/agent/planner.py) L90-126 的函数仅在自身定义处出现，没有任何调用方。`parallel_execute` 工具已注册并可用，但完全靠 LLM 自主决定调用
4. **HITL 链路已存在但有架构冲突**：`graph.py` planner_node → `plan_proposed` WS 事件 → `chat.py` `plan_response` 处理 → `useChat.ts` 事件路由 → `PlanCard.vue` UI → `ChatWindow.vue` 集成，链路完整，但 planner_node 中将 plan 确认结果直接 return 给 state（L230-231），与"plan-and-execute 重构后 executor 节点接管"存在架构冲突
5. **文档与代码已脱节**：`docs/01`、`docs/02` 描述 `create_react_agent`，但实际 `build_agent` 已重构为手写 `StateGraph`（planner → agent ↔ tools）。本阶段不修文档（避免范围蔓延）
6. **build_agent 调用面广**：6 处调用（chat.py / server.py ×2 / tool_parallel.py / tool_call_sub_agent.py / 测试），签名变化会引发连锁修改，必须保持向后兼容

---

## 子任务 2.1 — executor 节点 + 步骤状态机

**目标**：在 LangGraph 图中新增 executor 节点，负责按步骤驱动执行、维护步骤状态机，让 plan-and-execute 从"计划仅作为 SystemMessage 注入"升级为"步骤级执行追踪"。

### 2.1.1 核心改动文件

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [agent/graph.py](file:///d:/Maxma/MaxmaHere/agent/graph.py) | 构建 planner→agent↔tools 状态图，定义 AgentState/planner_node/should_continue/build_agent | ① AgentState (L113-115) 新增 step 状态机字段（plan_steps/current_step_index/step_status/parallel_groups/failure_count 等）；② 新增 `executor_node` 节点函数，负责按步骤驱动执行、更新步骤状态；③ build_agent (L254-276) 重构图拓扑：planner → executor ↔ agent/tools，executor 内含步骤循环 + 状态机路由；④ should_continue (L245-250) 增加"步骤是否全部完成"判断分支；⑤ planner_node (L173-231) 改为只生成 plan 并写入 state，不再直接注入 SystemMessage |
| [agent/planner.py](file:///d:/Maxma/MaxmaHere/agent/planner.py) | PLANNER_PROMPT、classify_and_plan、parse_plan_steps、extract_parallel_groups、PLAN_CONFIRM_THRESHOLD | ① 新增结构化 plan 解析（返回 `[{step, tool_hint, parallel_group, depends_on}]` 而非纯文本）；② parse_plan_steps (L63-87) 输出结构化步骤对象；③ 可能新增 `replan_from_failure()` 钩子签名 |
| [api/server.py](file:///d:/Maxma/MaxmaHere/api/server.py) | lifespan 中 build_agent 调用（L133 事件钩子、L205 const 会话重建） | 若 build_agent 签名变化（如新增 executor 配置），需同步两处调用；事件钩子场景 (L82-168) 无 ws，需确保 executor 在无 HITL 时不阻塞 |
| [api/routes/chat.py](file:///d:/Maxma/MaxmaHere/api/routes/chat.py) | `_run_agent_turn` 中 build_agent 调用 (L506-512)、_stream_turn (L201-239) | build_agent 调用参数可能变化；_stream_turn 需识别 executor_node 的 `on_chain_end` 事件名（当前仅识别 "agent"/"tools"） |
| [tools/sub_agent/tool_parallel.py](file:///d:/Maxma/MaxmaHere/tools/sub_agent/tool_parallel.py) | parallel_execute 工具，_run_background 中 build_agent 调用 (L186) | build_agent 调用签名同步；**子 Agent 内部不应再触发 executor**（递归层级控制），需为 build_agent 增加 `enable_executor=False` 参数 |
| [tools/sub_agent/tool_call_sub_agent.py](file:///d:/Maxma/MaxmaHere/tools/sub_agent/tool_call_sub_agent.py) | call_sub_agent 工具，_run_background 中 build_agent 调用 (L191) | 同上，build_agent 签名同步；子 Agent 用简化图（不启用 executor） |
| [config/settings.py](file:///d:/Maxma/MaxmaHere/config/settings.py) | 第三方 API key + 端口配置 | 新增配置项：`plan_confirm_timeout`、`replan_threshold`、`executor_max_replans`、`executor_enable_by_default` |

### 2.1.2 测试文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [tests/test_agent/test_graph.py](file:///d:/Maxma/MaxmaHere/tests/test_agent/test_graph.py) | 仅测试 `_request_plan_confirmation` 的 pending 清理 | 新增 executor_node 单测：步骤推进、状态机迁移、并行组识别、失败重规划触发；新增 AgentState 字段断言测试 |
| [tests/test_agent/test_planner.py](file:///d:/Maxma/MaxmaHere/tests/test_agent/test_planner.py) | 测试 classify_and_plan 与 PLANNER_PROMPT | 新增结构化 plan 解析测试、`extract_parallel_groups` 边界测试（已有函数但无单测） |
| [tests/test_api/test_event_hook_callback.py](file:///d:/Maxma/MaxmaHere/tests/test_api/test_event_hook_callback.py) | 事件钩子回调中 build_agent 调用 | build_agent 签名同步 |
| [tests/test_api/test_chat_image_refs.py](file:///d:/Maxma/MaxmaHere/tests/test_api/test_chat_image_refs.py) | 图片引用测试中 build_agent mock | mock 签名同步 |

### 2.1.3 新建文件

| 文件路径 | 职责 |
|---|---|
| `agent/executor.py` | executor_node 实现 + 步骤状态机逻辑（从 graph.py 拆出，避免 graph.py 膨胀）。包含 `executor_node`、`StepStateMachine`、`advance_step`、`handle_step_failure` 等 |
| `agent/step_state.py` | 步骤状态机数据类定义（`PlanStep`、`StepStatus` 枚举、`ExecutionPlan`）。AgentState 扩展字段类型来源 |
| `tests/test_agent/test_executor.py` | executor_node + 步骤状态机单测（步骤推进、并行组、失败重规划、HITL 确认） |
| `tests/test_agent/test_replan.py` | replan 函数单测（失败上下文注入、修订计划生成） |

### 2.1.4 关键设计点

- **AgentState 扩展方向**：当前仅 `messages`。需新增非消息类字段（plan/step_index/step_status/failure_count），这些字段不进 LLM 上下文，仅用于图内路由。**必须为每个新字段定义 reducer**（默认用 `operator.or_` 或覆盖式更新），否则 LangGraph 状态合并会出错
- **executor 与 agent 节点的边界**：executor 负责步骤编排与状态机推进，agent 节点仍负责单步 LLM 推理 + 工具调用。拓扑建议：`planner → (HITL confirm) → executor → agent ↔ tools → executor`（executor 在每步完成后 regain 控制权决定下一步）
- **build_agent 向后兼容**：新增参数带默认值（如 `enable_executor: bool = True`、`ws: Optional[WebSocket] = None`），保持 6 处调用方不破坏
- **子 Agent 递归控制**：`tool_parallel.py`/`tool_call_sub_agent.py` 的 `_run_background` 调用 build_agent 构建子 Agent 时，必须传 `enable_executor=False`，否则递归爆炸

### 2.1.5 风险

- **build_agent 调用面广**：6 处调用，签名变化会引发连锁修改。缓解：新参数带默认值，保持旧调用方零改动
- **WS 事件流兼容性**：前端 `useChat.ts` 的 `handleEventForChannel` 用 switch 处理事件类型。新增 plan_step_* 事件必须同步前端类型，否则前端静默丢弃
- **事件钩子无 ws 场景**：`api/server.py` L82-168 的事件钩子 build_agent 不传 ws，executor 的 HITL 会阻塞。必须检测 `ws is None` 时跳过 HITL 或走 auto_approve

### 2.1.6 状态

- [x] 已完成（在前序会话中完成：AgentState 扩展 9 个步骤状态机字段；executor_node + StepStateMachine 实现；build_agent 保持向后兼容（enable_executor/enable_hitl 参数带默认值）；子 Agent 传 enable_executor=False 防递归；config/settings.py 新增 4 个配置项；test_graph.py 含 executor 单测）

---

## 子任务 2.2 — 接入 extract_parallel_groups，基于 plan 触发 parallel_execute

**目标**：让 `extract_parallel_groups`（当前死代码）真正被调用，executor 检测到并行组后自动触发 `parallel_execute`，而非靠 LLM 自主决定。

### 2.2.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [agent/planner.py](file:///d:/Maxma/MaxmaHere/agent/planner.py) | extract_parallel_groups (L90-126) 已定义但无调用方 | 函数本身基本不动，但需确保输出格式与 executor_node 消费端对齐；可能补充"并行组依赖关系"字段 |
| [agent/graph.py](file:///d:/Maxma/MaxmaHere/agent/graph.py) | planner_node 生成 plan 后直接注入 SystemMessage | 在 executor_node 中调用 `extract_parallel_groups(plan)`，当存在并行组时自动构造 `parallel_execute` 的 tasks 参数并触发工具调用（而非等 LLM 自主决定）；非并行步骤走原 agent_node 推理 |
| [tools/sub_agent/tool_parallel.py](file:///d:/Maxma/MaxmaHere/tools/sub_agent/tool_parallel.py) | parallel_execute 工具，接收 JSON tasks 字符串 | 可能新增"由 executor 程序化调用"的入口（绕过 LLM tool_call 的 JSON 序列化），或保持现状由 executor 注入 tool_call 到 state |
| [tools/sub_agent/TOOL.md](file:///d:/Maxma/MaxmaHere/tools/sub_agent/TOOL.md) | 子 Agent 工具领域知识 | 补充"executor 自动触发 parallel_execute"的说明 |

### 2.2.2 不动的现有文件

| 文件路径 | 说明 |
|---|---|
| [tools/sub_agent/tool_call_sub_agent.py](file:///d:/Maxma/MaxmaHere/tools/sub_agent/tool_call_sub_agent.py) | 参考，不直接改动 |
| [tools/__init__.py](file:///d:/Maxma/MaxmaHere/tools/__init__.py) | parallel_execute 已在 CORE_TOOLS (L370) 且已注册 (L182)；"并行"关键词映射已存在 (L448) |

### 2.2.3 关键设计点

- **parallel_execute 程序化触发**：executor 检测到并行组后，有两种实现路径——
  - **方案 A（推荐）**：向 state 注入一个"建议调用 parallel_execute"的 SystemMessage，让 LLM 自主调用（保持 ReAct 范式，但可能被 LLM 忽略）
  - **方案 B（兜底）**：直接在 executor 内调用 `ParallelExecuteTool._arun`（绕过 LLM，快但破坏 ReAct 范式）
  - 建议方案 A 为主 + 失败兜底方案 B
- **并行组依赖关系**：当前 `extract_parallel_groups` 仅返回 `List[List[str]]`（组列表），无组间依赖。若需支持"组 B 依赖组 A 结果"，需扩展输出格式

### 2.2.4 状态

- [x] 已完成（方案 A：executor 注入 `[并行执行建议]` SystemMessage，LLM 自主调用 `parallel_execute`；同组所有步骤一起标记 RUNNING/DONE/FAILED/SKIPPED；6 个并行组测试 + 6 个并行执行测试全绿）

---

## 子任务 2.3 — 失败重规划机制

**目标**：接入当前死代码 `error_recovery.py`，让工具失败达到阈值后触发 replan（而非直接返回错误给 LLM），实现真正的失败恢复。

### 2.3.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [agent/error_recovery.py](file:///d:/Maxma/MaxmaHere/agent/error_recovery.py) | ErrorRecoveryManager + retry_network_call（**死代码，无调用方**） | ① 接入 executor_node：工具失败时调用 record_failure；② 新增 `should_replan(tool_name, failure_count)` 判断；③ 可能新增 `ReplanTrigger` 事件类型；④ `_suggest_alternatives` (L173-184) 扩充并行/sub_agent 场景的替代工具映射 |
| [agent/graph.py](file:///d:/Maxma/MaxmaHere/agent/graph.py) | tools 节点失败后无重规划，仅 ToolMessage 返回 agent_node | ① executor_node 中捕获工具失败 → 调用 ErrorRecoveryManager.record_failure → 达到阈值触发 replan；② 新增"replan"路由边：executor → planner（携带失败上下文 SystemMessage）；③ AgentState 新增 failure_count/last_failed_step 字段 |
| [agent/planner.py](file:///d:/Maxma/MaxmaHere/agent/planner.py) | classify_and_plan 只接受 user_message | 新增 `replan(model, original_plan, failed_step, error) -> str`：基于原计划 + 失败信息生成修订计划；PLANNER_PROMPT 补充 replan 子模板 |
| [agent/performance.py](file:///d:/Maxma/MaxmaHere/agent/performance.py) | 性能监控（record_tool_call 已记录 success 字段） | 在 executor_node 中调用 record_tool_call(success=False) 记录失败工具；end_turn 时若 failure_count 高则标记 slow/errored |
| [api/routes/chat.py](file:///d:/Maxma/MaxmaHere/api/routes/chat.py) | _run_agent_turn 异常处理 (L569-598) | Agent 执行异常时调用 interaction.cancel_session（已有）；可能补充"重规划失败 N 次后优雅降级"逻辑 |
| [api/callbacks/websocket_callback.py](file:///d:/Maxma/MaxmaHere/api/callbacks/websocket_callback.py) | on_tool_error 推送 tool_error 事件 (L156-169) | 不动（失败事件推送链路已存在，executor 可复用） |

### 2.3.2 不动的参考文件

| 文件路径 | 参考内容 |
|---|---|
| [agent/hooks.py](file:///d:/Maxma/MaxmaHere/agent/hooks.py) | HookManager 的"失败状态机"模式（STATUS_ERROR 等），参考不改动 |
| [build/maxma-server.spec](file:///d:/Maxma/MaxmaHere/build/maxma-server.spec) | 打包配置（已包含 error_recovery 模块） |
| [CODE_REVIEW.md](file:///d:/Maxma/MaxmaHere/CODE_REVIEW.md) | 代码审查记录（提及 error_recovery） |

### 2.3.3 关键设计点

- **error_recovery 接入点**：当前 ToolNode 失败后直接写 ToolMessage 返回。接入点应在 executor 监听 `on_tool_error` 事件或检查 ToolMessage.content 中的 `format_error` 标记，达到 `FAILURE_THRESHOLD`（默认 2）后触发 replan 路由到 planner
- **replan 的上下文注入**：replan 时需向 planner 传递"原计划 + 失败步骤 + 错误信息"，而非重新 classify_and_plan（否则会丢失已成功步骤）。建议新增 `replan()` 函数而非复用 `classify_and_plan()`
- **重规划次数上限**：`executor_max_replans`（默认 2）防止无限重规划循环

### 2.3.4 风险

- **error_recovery 线程安全**：`ErrorRecoveryManager` 用 `threading.Lock`，但 executor 在 asyncio 事件循环中运行。Lock 不会死锁（同步锁在协程中只是阻塞事件循环），但高并发会话下可能成为瓶颈。建议评估是否改为 `asyncio.Lock`

### 2.3.5 状态

- [x] 已完成（error_recovery.py 接入 executor：record_failure / should_replan / build_replan_trigger；
  PerformanceMonitor.record_tool_call(success=False) 集成；
  ReplanTrigger 携带 alternative_tools + suggestion_message；
  _suggest_alternatives 扩充 parallel_execute → call_sub_agent 退化映射；
  _state_summary 新增 is_degraded / skipped_step_indices / failed_step_indices；
  api/routes/chat.py 新增 _maybe_notify_plan_degraded 推送 plan_degraded WS 事件；
  26 个 Task 2.3 单测全绿，vue-tsc + vite build（391 modules）通过）

---

## 子任务 2.4 — 打通 planner 阈值触发 HITL 确认链路

**目标**：修复 PlanCard 前端"看得见但点不动"的 UX 断层，让 planner 生成计划后必须等用户确认（≥阈值步数时）才能进入 executor 执行。

### 2.4.1 后端改动文件

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [agent/graph.py](file:///d:/Maxma/MaxmaHere/agent/graph.py) | planner_node (L199-228) 已有 plan_proposed + _request_plan_confirmation 流程 | ① 重构后 planner_node 将 plan 写入 state（不直接 return SystemMessage），HITL 确认在 executor 前置阶段完成；② `_request_plan_confirmation` (L118-149) 保持核心逻辑，但调用时机迁移到 executor 入口；③ 确认通过后 executor 接管，拒绝/修改/超时分别走不同 state 迁移 |
| [api/routes/chat.py](file:///d:/Maxma/MaxmaHere/api/routes/chat.py) | websocket_chat 中 plan_response 处理 (L793-806) | ① 确认 plan_response 与新 executor 状态机对齐；② 修改/拒绝时通过 state 更新（aupdate_state）而非依赖 planner_node return；③ _run_agent_turn (L420-693) 中 build_agent 调用需传入 ws（已有 L511） |
| [api/callbacks/websocket_callback.py](file:///d:/Maxma/MaxmaHere/api/callbacks/websocket_callback.py) | LangChain 事件 → WS 推送 | 可能新增"plan_step_start/plan_step_end/plan_step_error"事件类型，用于 executor 步骤进度可视化 |

### 2.4.2 不动的后端文件（可复用）

| 文件路径 | 说明 |
|---|---|
| [api/interaction.py](file:///d:/Maxma/MaxmaHere/api/interaction.py) | Future 注册表（register/resolve/cleanup/cancel_session），HITL 复用 ask_user 同款 Future 机制，已成熟；plan_id 作为 interaction_id 已支持 |
| [api/ws_registry.py](file:///d:/Maxma/MaxmaHere/api/ws_registry.py) | WebSocket 注册表，不动 |
| [tools/interaction/tool_ask_user.py](file:///d:/Maxma/MaxmaHere/tools/interaction/tool_ask_user.py) | ask_user HITL 模式参考，不动 |
| [tools/interaction/tool_ask_confirm.py](file:///d:/Maxma/MaxmaHere/tools/interaction/tool_ask_confirm.py) | 确认类 HITL 参考，不动 |

### 2.4.3 前端改动文件

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [web/src/components/PlanCard.vue](file:///d:/Maxma/MaxmaHere/web/src/components/PlanCard.vue) | 计划确认卡片 UI（approve/edit/reject） | ① 新增步骤执行进度展示（当前步骤高亮、已完成/失败标记）；② 状态扩展 'running'/'failed'/'replanning'；③ 失败时显示"重规划中"提示 |
| [web/src/composables/useChat.ts](file:///d:/Maxma/MaxmaHere/web/src/composables/useChat.ts) | plan_proposed 事件处理 (L472-490)、sendPlanResponse (L685-701) | ① plan_proposed 事件写入 currentTurn.planCard（已有）；② 新增 plan_step_* 事件处理，更新 planCard.steps 状态；③ sendPlanResponse 状态更新逻辑同步 |
| [web/src/types/index.ts](file:///d:/Maxma/MaxmaHere/web/src/types/index.ts) | PlanProposedEvent (L80-87)、PlanCard (L90-95) | ① PlanCard 新增 currentStepIndex/stepStatuses 字段；② 新增 PlanStepStartEvent/PlanStepEndEvent/PlanStepErrorEvent/ReplanEvent 类型；③ ServerEvent 联合类型扩展 |
| [web/src/components/ChatWindow.vue](file:///d:/Maxma/MaxmaHere/web/src/components/ChatWindow.vue) | PlanCard 集成 (L22-26, L176) | PlanCard props 可能扩展（步骤状态透传）；onPlanRespond 处理可能新增 action 类型 |

### 2.4.4 不动的前端文件

| 文件路径 | 说明 |
|---|---|
| [web/src/views/ChatView.vue](file:///d:/Maxma/MaxmaHere/web/src/views/ChatView.vue) | sendPlanResponse 通过 useChat 注入 (L114, L73)，已正确解耦，无需改动 |
| [web/src/stores/chat.ts](file:///d:/Maxma/MaxmaHere/web/src/stores/chat.ts) | 会话通道状态（无 plan 专属逻辑） |
| [web/src/api/index.ts](file:///d:/Maxma/MaxmaHere/web/src/api/index.ts) | REST API 封装（无 plan 相关） |

### 2.4.5 测试文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [tests/test_agent/test_graph.py](file:///d:/Maxma/MaxmaHere/tests/test_agent/test_graph.py) | _request_plan_confirmation 单测 | 补充 executor 状态机下的 HITL 链路测试 |

### 2.4.6 关键设计点

- **HITL 与 executor 的时序**：HITL 确认必须在 executor 开始执行第一步之前完成。planner_node 生成 plan → 写入 state → executor 入口检查 `plan_confirmed` 标志，未确认则调用 `_request_plan_confirmation` 阻塞等待
- **阈值触发**：`PLAN_CONFIRM_THRESHOLD = 3`（planner.py L19）保持不变，≥3 步才触发 HITL 确认；简单任务直接执行不阻塞
- **plan_proposed 写入 currentTurn 的时机**：`useChat.ts` L480 要求 `ch.currentTurn` 存在。需确认 WS 事件顺序，避免 planner_node 在 `_stream_turn` 启动前就发 plan_proposed 导致 currentTurn 未初始化

### 2.4.7 风险

- **WS 事件流兼容性**：前端 `useChat.ts` 的 `handleEventForChannel` 用 switch 处理事件类型。新增 plan_step_* 事件必须同步前端类型，否则前端静默丢弃。当前 `done` 事件会清空 currentTurn (L404-426)，若 plan 在 done 后还有延迟事件会丢失

### 2.4.8 状态

- [x] 已完成（在前序会话中完成：planner_node 生成计划后写入 state 不再注入 SystemMessage；executor 入口完成 HITL 确认（plan_confirmed 标志驱动）；PlanCard.vue 重写支持步骤进度/running/failed/replanning 状态；useChat.ts 添加 plan_step_start/end/error/completed 事件处理；types/index.ts 新增 PlanStepStartEvent 等类型；approve/modify/reject/timeout 四态正确迁移 state；ws is None 场景跳过 HITL）

---

## 实施顺序建议

```
2.1 executor 节点 + 步骤状态机（基础，2.2/2.3/2.4 都依赖）
    ↓
2.4 打通 HITL 链路（基于 2.1 的 executor 入口）
    ↓
2.2 接入并行规划（在 executor 中调用 extract_parallel_groups）
    ↓
2.3 失败重规划（接入 error_recovery，executor → planner 路由）
```

**并行机会**：
- 2.2 与 2.4 可并行（都依赖 2.1，但彼此独立）
- 2.3 必须在 2.1 完成后（需要 executor 节点作为接入点），但可与 2.2/2.4 并行

**关键约束**：
- 2.1 是所有子任务的基础，必须先完成
- 2.1 的 build_agent 签名变更必须保持向后兼容（6 处调用方）

---

## 验收标准

| 子任务 | 验收点 |
|---|---|
| 2.1 | AgentState 含步骤状态机字段；executor_node 按步骤驱动执行；build_agent 6 处调用方零破坏；子 Agent 不触发 executor 递归 |
| 2.2 | extract_parallel_groups 被调用；并行组自动触发 parallel_execute；非并行步骤走原 agent_node 推理 |
| 2.3 | error_recovery 不再是死代码；工具失败 ≥2 次触发 replan；replan 保留已成功步骤；重规划上限防止循环 |
| 2.4 | ≥3 步计划必须等用户确认才执行；PlanCard 显示步骤执行进度；approve/modify/reject 三态正确迁移 state；事件钩子无 ws 场景跳过 HITL |

---

## 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| build_agent 调用面广（6 处） | 新参数带默认值（`enable_executor`/`ws`/`enable_hitl`），保持旧调用方零改动 |
| AgentState 字段缺 reducer 导致状态合并错误 | 每个新字段必须定义 reducer（`operator.or_` 或覆盖式），写单测验证 |
| 子 Agent 递归爆炸 | build_agent 增加 `enable_executor=False` 参数，子 Agent 用简化图 |
| 事件钩子无 ws 导致 HITL 阻塞 | executor 入口检测 `ws is None`，跳过 HITL 或走 auto_approve |
| WS 事件前端静默丢弃 | 新增 plan_step_* 事件必须同步 `web/src/types/index.ts` 的 ServerEvent 联合类型 |
| error_recovery 线程锁阻塞事件循环 | 评估改为 asyncio.Lock；或保持 threading.Lock 但限制临界区粒度 |
| 文档与代码脱节加剧 | 本阶段不修文档（避免范围蔓延），在阶段 2 完成后单独修 docs/01、docs/02 |
| plan_proposed 事件时机早于 currentTurn 初始化 | 确认 _stream_turn 启动顺序，必要时在 useChat.ts 增加 currentTurn 兜底初始化 |

---

## 与阶段 1 的依赖关系

| 阶段 1 子任务 | 阶段 2 依赖点 |
|---|---|
| 1.7 工具注册去中心化 | 降低 build_agent 调用面变更冲突（新工具自动注册，无需改 tools/__init__.py） |
| 1.1 RAG 子系统 | 无直接依赖（2.x 不涉及记忆检索）。注：阶段 1 已将 embedding 后端从 sentence-transformers+torch 切换为 ONNX Runtime 直推，阶段 2 无需安装 torch |
| 1.2 4 层记忆架构 | 无直接依赖（2.x 不涉及记忆分层） |
| 1.6 metrics SQLite 持久化 | 可选：executor 步骤状态变更可作为 metrics_events 落盘（非阻塞依赖） |

**结论**：阶段 2 仅硬依赖阶段 1.7（工具注册），可在 1.7 完成后立即启动；与 1.1-1.6 可并行推进。
