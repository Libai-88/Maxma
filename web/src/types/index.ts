import type { ParsedRef } from '@/utils/references'

import type { InteractiveArtifact } from './workbench'
import type { PermissionMode } from './session'

// === WebSocket 服务端 → 客户端事件 ===

export interface ThinkingStartEvent {
  type: 'thinking_start'
  payload: { timestamp: number }
}

export interface TokenEvent {
  type: 'token'
  payload: { token: string }
}

export interface ThinkingEndEvent {
  type: 'thinking_end'
  payload: { timestamp: number }
}

export interface ThinkingDeltaEvent {
  type: 'thinking_delta'
  payload: { delta: string }
}

export interface ToolStartEvent {
  type: 'tool_start'
  payload: { tool_name: string; input: string }
}

export interface ToolEndEvent {
  type: 'tool_end'
  payload: { tool_name: string; output: string; elapsed: number; tool_data?: Record<string, unknown> }
}

export interface ToolErrorEvent {
  type: 'tool_error'
  payload: { tool_name: string; error: string; elapsed?: number }
}

export interface ToolUpdateEvent {
  type: 'tool_update'
  payload: { tool_name: string; partial_result: string }
}

export interface RetryStartEvent {
  type: 'retry_start'
  payload: { attempt: number; max_attempts: number; delay_ms: number; error_message: string }
}

export interface RetryEndEvent {
  type: 'retry_end'
  payload: { success: boolean; attempt: number; final_error?: string }
}

export interface TodoReminderEvent {
  type: 'todo_reminder'
  payload: { todos: Array<{ content: string; status: string }>; attempt: number; max_attempts: number }
}

export interface NoticeEvent {
  type: 'notice'
  payload: { level: 'info' | 'warning' | 'error'; message: string; source?: string }
}

export interface IrcMessageEvent {
  type: 'irc_message'
  payload: { from: string; to: string; body: string; id: string }
}

export interface AnswerEvent {
  type: 'answer'
  payload: {
    content: string
    /**
     * 引擎（pi）在 message_end 上带出的权威用量。bridge 一直发，
     * 但此前类型只声明 content，前端把整包丢了；这里补上供
     * llm_usage 缺失时兜底（老引擎/缓存预热轮）。
     */
    usage?: PiUsage | null
    provider?: string | null
    model?: string | null
    request_duration_ms?: number | null
    request_shape_hash?: string | null
    prefix_fingerprint?: string | null
    fingerprint_epoch?: number | null
  }
}

export interface DoneEvent {
  type: 'done'
  payload: { turn_id?: string; context_usage?: ContextUsage }
}

/**
 * pi 的 Usage 形状（官方 message.usage）。字段名与引擎逐字对齐：
 * `input` / `output` / `cacheRead` / `cacheWrite`，不要按 OpenAI 的
 * `prompt_tokens` 那套猜。后端 llm-usage-ledger 也按同一组键落库。
 */
export interface PiUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number }
}

/**
 * 引擎派生用量事件（`MAXMA_ENGINE_WS_EVENTS` 里的 `llm_usage`）。
 *
 * 两种 kind：
 *   - `model_request`：一次真实模型请求结束（bridge 从 message_end 派生），
 *     带 provider/model/时长/缓存与价格状态；
 *   - `cache_warm`：pi 的 usage entry（kind=cache_warm），不进对话上下文，
 *     但确实施了缓存读取 token。
 *
 * 此前它既不在 `ServerEvent` 联合、也不在 `SERVER_EVENT_HANDLER_TYPES`，
 * 前端入口守卫只在控制台 warn 一句就丢掉——于是「每轮用了多少 token、
 * 走的哪个模型、缓存命没命中」在对话里完全不可见（只有指标页的聚合）。
 */
export interface LlmUsageEvent {
  type: 'llm_usage'
  payload: {
    kind: 'model_request' | 'cache_warm'
    usage_source?: string
    usage_entry_id?: string | null
    occurred_at?: string | null
    usage?: PiUsage | null
    provider?: string | null
    model?: string | null
    request_duration_ms?: number | null
    price_status?: 'catalog_estimate' | 'unknown' | string | null
    cache_status?: 'observed' | 'unknown' | string | null
    request_shape_hash?: string | null
    prefix_fingerprint?: string | null
    fingerprint_epoch?: number | null
  }
}

/** 单轮对话的用量（由 llm_usage / answer 事件累加得出）。 */
export interface TurnUsage {
  provider: string | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  /** 最后一次请求的耗时；多请求轮次取最后一次（它是产出最终回答的那次）。 */
  durationMs: number | null
  cacheStatus: 'observed' | 'unknown' | null
  priceStatus: 'catalog_estimate' | 'unknown' | null
  /** 本轮内真实模型请求数（fallback / 多步会产生多次）。 */
  requests: number
  /** 本轮内缓存预热次数与它们的缓存读取 token，单独计数（不进命中率）。 */
  warmCalls: number
}

export interface RateLimitDetails {
  retry_after: number
  limit: number
  remaining: number
}

export interface ErrorEvent {
  type: 'error'
  payload: {
    code: string
    message: string
    category?: 'user_error' | 'tool_error' | 'system_error' | 'rate_limit' | 'cancelled'
    details?: RateLimitDetails & Record<string, unknown>
    trace_id?: string
    diagnostic?: Record<string, unknown>
  }
}

export interface PongEvent {
  type: 'pong'
  payload: Record<string, never>
}

/** UNIMPLEMENTED (B4): 独立 context_usage WS 事件无发射端 —— 用量只通过
 * done.payload.context_usage 内嵌 + REST GET 达前端。useChat 有处理分支但永不触发。 */
export interface ContextUsageEvent {
  type: 'context_usage'
  payload: ContextUsage
}

/** 会话上下文压缩事件。
 * A3 接通：sidecar auto_compaction_end → context_compressed（auto 压缩时实时推送）。
 * 手动压缩经 REST 返回，不产此 WS 事件。payload 部分字段（removed_count/after_tokens）
 * auto_compaction_end 未携带 → undefined；前端已防御。 */
export interface ContextCompressedEvent {
  type: 'context_compressed'
  payload: {
    compressed: boolean
    removed_count?: number
    summary_preview?: string
    before_tokens?: number
    after_tokens?: number
    /** 压缩前/后上下文占比（0-1 浮点数） */
    context_usage_before?: number
    context_usage_after?: number
  }
}

/** 压缩触发原因。
 * 'manual' 来自 pi 的 compaction_start 事件（见
 * bun-backend/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts:61
 * `reason: "manual" | "threshold" | "overflow"`）。
 * 注：sidecar 的 kernel/events.ts 目前把未知取值钳成 'threshold'，所以 'manual'
 * 暂时不会真的到达前端；类型先补齐，避免钳位放开后前端按 undefined 渲染文案。
 * 'idle' / 'incomplete' 为上一代引擎（OMP）取值，保留以兼容历史转录。 */
export type CompactionReason = 'manual' | 'threshold' | 'overflow' | 'idle' | 'incomplete'
export type CompactionAction = 'context-full' | 'handoff' | 'shake' | 'snapcompact'

export interface ContextCompressingEvent {
  type: 'context_compressing'
  payload: { reason: CompactionReason; action: CompactionAction }
}

/** ask_user 交互工具向用户展示的问题和选项 */
export interface AskUserEvent {
  type: 'ask_user'
  payload: {
    tool_name: string
    question: string
    /** 交互模式：qa/single_choice/multi_choice/confirm 为普通询问；approval 为工具执行审批 */
    mode: 'qa' | 'single_choice' | 'multi_choice' | 'confirm' | 'approval'
    /** 普通模式为 string[]；approval 模式为 {label,value}[] */
    options: string[] | { label: string; value: string }[]
    interaction_id: string
    code?: string
    /** approval 模式：审批原因/说明 */
    detail?: string
    /** approval 模式：风险等级。
     * 已实现（Phase 2.1）：session-bridge.ts parseApprovalTitle 从格式化 title 解析。 */
    risk_level?: 'low' | 'medium' | 'high'
    /** approval 模式：工具调用参数。
     * 已实现（Phase 2.1）：session-bridge.ts parseApprovalTitle 从格式化 title 解析。 */
    tool_input?: Record<string, unknown>
  }
}

/** 审批请求事件 payload（mode='approval' 时 AskUserEvent.payload 的结构参考） */
export interface ApprovalRequestPayload {
  tool_name: string
  interaction_id: string
  mode: 'approval'
  question: string
  detail: string
  risk_level: 'low' | 'medium' | 'high'
  tool_input: Record<string, unknown>
  options: { label: string; value: string }[]
}

/** 已接通：由后端 chat.py 透传 sidecar 的 plan_proposed 事件。 */
export interface PlanProposedEvent {
  type: 'plan_proposed'
  payload: {
    plan_id: string
    steps: string[]
    plan_text: string
  }
}

/** 已接通：同 PlanProposedEvent，由后端透传。 */
export interface PlanStepStartEvent {
  type: 'plan_step_start'
  payload: {
    step_index: number
    step_description: string
    tool_hint?: string
    total_steps: number
  }
}

/** 已接通：同 PlanProposedEvent，由后端透传。 */
export interface PlanStepEndEvent {
  type: 'plan_step_end'
  payload: {
    step_index: number
    step_description: string
    status: 'done' | 'skipped'
  }
}

/** 已接通：同 PlanProposedEvent，由后端透传。 */
export interface PlanStepErrorEvent {
  type: 'plan_step_error'
  payload: {
    step_index: number
    step_description: string
    error: string
    replanning: boolean
    skipped?: boolean
  }
}

/** 已接通：同 PlanProposedEvent，由后端透传。 */
export interface PlanCompletedEvent {
  type: 'plan_completed'
  payload: {
    summary: {
      total_steps: number
      current_step_index: number
      statuses: Record<string, string>
      failure_count: number
      replan_count: number
      is_complete: boolean
    }
  }
}

/** 前端计划卡片状态 */
export interface PlanCard {
  planId: string
  steps: string[]
  planText: string
  status: 'pending' | 'approved' | 'modified' | 'rejected' | 'running' | 'failed' | 'replanning'
  /** 当前执行步骤索引（-1 表示未开始） */
  currentStepIndex?: number
  /** 各步骤状态：{ step_index_str: 'pending' | 'running' | 'done' | 'failed' | 'skipped' } */
  stepStatuses?: Record<string, string>
  /** 工具提示 */
  toolHints?: Record<string, string>
  /** 失败次数 */
  failureCount?: number
  /** 重规划次数 */
  replanCount?: number
}

/** 已实现（Phase 3.4）：通过 EventBus 订阅 TASK_SUBAGENT_LIFECYCLE_CHANNEL 实现。
 * session-bridge.ts 在 createAgentSession 后订阅 EventBus，将子任务生命周期
 * 事件映射为 Maxma 的 sub_session_created 事件。 */
export interface SubSessionCreatedEvent {
  type: 'sub_session_created'
  payload: {
    sub_session_id: string
    parent_session_id: string | null
    task: string
    name: string
  }
}

/** 部分实现（Phase 3.4）：后端 deferred_run_manager 已就绪，支持 REST 创建/查询。
 * 需产品决策是否补全 WebSocket 事件推送。 */
export interface DeferredSubagentSubmittedEvent {
  type: 'deferred_subagent_submitted'
  payload: {
    run_id: string
    parent_turn_id: string | null
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
    result_ref: string | null
    /** 列表/WS 投影恒为 null；全文走 GET /deferred-runs/:runId。 */
    result: string | null
    cancel_reason: string | null
    deadline_at: number | null
    attempts: number
    created_at: number
    updated_at: number
    error_code?: string | null
    error_message?: string | null
  }
}

/** 已实现：后端 TOOL_END 检测文件写入工具后合成（Phase 2.2）。
 * 事件负载为 InteractiveArtifact（choice 类型），token 中编码文件路径。 */
export interface ArtifactEvent {
  type: 'artifact'
  payload: InteractiveArtifact
}

/** ARTIFACT-ACK-001：后端对 artifact_action 的确认回执。
 * status=completed 表示动作成功；status=error 表示执行失败（token 失效/
 * 动作非法等），前端据此回滚乐观的"已提交"标记。 */
export interface ArtifactResultEvent {
  type: 'artifact_result'
  payload: {
    artifact_id: string
    action_id: string
    status: 'completed' | 'error'
    content?: string | null
    error?: string | null
  }
}

/** UNIMPLEMENTED (B4): 无发射端/无订阅。OMP memory 跑在 mnemopi 独立 state，
 * 不经 AgentSessionEvent subscribe 流。UI 已就绪待深接。 */
export interface MemoryToolStartEvent {
  type: 'memory_tool_start'
  payload: {
    turn_id: string
    tool_name: string
    input: string
  }
}

/** UNIMPLEMENTED (B4): 无发射端/无订阅。同 MemoryToolStartEvent。 */
export interface MemoryToolEndEvent {
  type: 'memory_tool_end'
  payload: {
    turn_id: string
    tool_name: string
    output: string
    elapsed: number
  }
}

/** UNIMPLEMENTED (B4): 无发射端/无订阅。同 MemoryToolStartEvent。 */
export interface MemoryToolErrorEvent {
  type: 'memory_tool_error'
  payload: {
    turn_id: string
    tool_name: string
    error: string
  }
}

/** UNIMPLEMENTED (B4): 无发射端/无订阅。同 MemoryToolStartEvent。 */
export interface MemoryStartEvent {
  type: 'memory_start'
  payload: {
    turn_id: string
  }
}

/** UNIMPLEMENTED (B4): 无发射端/无订阅。同 MemoryToolStartEvent。 */
export interface MemoryDoneEvent {
  type: 'memory_done'
  payload: {
    turn_id: string
  }
}

/**
 * ServerEvent 联合 —— 服务端→浏览器 WS 事件。
 *
 * 真实通路:
 *   - 基础对话: thinking_start/end, token, tool_start/end/error, answer, done, error
 *   - 推理: thinking_start/end
 *   - 工具进度: tool_update (tool_execution_update)
 *   - 审批: ask_user, pong
 *   - 上下文管理: context_compressed, context_compressing
 *   - 重试: retry_start, retry_end
 *   - 运行时通知: notice, todo_reminder, irc_message
 *   - 用量: context_usage (独立事件), done.payload.context_usage (内嵌)
 *
 * 实现状态（2026-11-02 复核）：
 *   - plan_* — 已实现：后端透传 sidecar 的 plan_proposed/step_start/step_end/step_error/completed
 *   - artifact / artifact_result — 已实现：后端 TOOL_END 检测写文件工具后合成 / 回执
 *   - sub_session_created — 已实现（Phase 3.4）：EventBus 订阅 TASK_SUBAGENT_LIFECYCLE_CHANNEL
 *   - deferred_subagent_submitted — 部分实现：后端 deferred_run_manager 已就绪，需产品决策
 *   - memory_* — 未实现：OMP memory 跑在独立状态，不通过事件流推送
 *   - workflow_step_start/end/error / workflow_completed — 2026-11-02 起**不存在**：
 *     后端那条死的 REST 工作流面（`bun-backend/src/routes/workflows.ts` 空 deps 挂载，
 *     sidecar 分支永远走不到）连同 kernel 的 `execute_workflow_step` 已整体删除，
 *     前端也从没有过消费者。恢复自动化是独立工作项，届时事件类型/分支/UI 一起新建。
 *   - llm_usage — 不属于前端：`chat-ws.ts` 的 `case "llm_usage"` 每条路径都 return，
 *     只落台账与 metrics，永不透传浏览器。用量到前端的常规路径是 done.payload.context_usage。
 *
 * 不变式（联合成员必须有分支）：新增 type 而不登记处理路径，
 *   1. `useChat.ts` 的 `SERVER_EVENT_HANDLER_TYPES`（Record<ServerEvent['type'], true>）
 *      缺键 → tsc 报错；
 *   2. `useChat.ts` 的 `SERVER_EVENT_HANDLER_TYPES`（`Record<ServerEvent['type'], true>`）在编译期
 *      逐一对账，并断言事件 switch 保留 `default` 兜底 → 测试红。
 */
export type ServerEvent =
  | ThinkingStartEvent
  | TokenEvent
  | ThinkingEndEvent
  | ThinkingDeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | ToolErrorEvent
  | ToolUpdateEvent
  | RetryStartEvent
  | RetryEndEvent
  | TodoReminderEvent
  | NoticeEvent
  | IrcMessageEvent
  | AnswerEvent
  | LlmUsageEvent
  | DoneEvent
  | ErrorEvent
  | PongEvent
  | ContextUsageEvent
  | ContextCompressedEvent
  | ContextCompressingEvent
  | ArtifactEvent
  | ArtifactResultEvent
  | AskUserEvent
  | PlanProposedEvent
  | PlanStepStartEvent
  | PlanStepEndEvent
  | PlanStepErrorEvent
  | PlanCompletedEvent
  | SubSessionCreatedEvent
  | DeferredSubagentSubmittedEvent
  | MemoryStartEvent
  | MemoryToolStartEvent
  | MemoryToolEndEvent
  | MemoryToolErrorEvent
  | MemoryDoneEvent
  | GoalUpdatedEvent
  | CollaborationUpdateEvent
  | TaskReviewUpdateEvent
  | TaskBriefUpdateEvent
  | PermissionModeUpdatedEvent
  | ActionFailedEvent

// === GAP-B1-001：目标模式状态事件 ===

export interface TaskBriefUpdateEvent {
  type: 'task_brief_update'
  payload: {
    turn_id?: string
    status: 'thinking' | 'clarify' | 'ready' | 'fallback'
    summary?: string
    questions?: string[]
    missing?: string[]
    assumptions?: string[]
    confidence?: number
    riskLevel?: 'low' | 'medium' | 'high'
    executionPrompt?: string
    error?: string
  }
}

export interface CollaborationUpdateEvent {
  type: 'collaboration_update'
  payload: {
    status: 'queued' | 'error'
    mode: 'steer' | 'follow_up'
    message: string
  }
}

export interface TaskReviewUpdateEvent {
  type: 'task_review_update'
  payload: {
    status: 'available' | 'accepted' | 'revising'
    turn_id: string
    answer?: string
    message?: string
  }
}

export interface TaskReviewState {
  turnId: string
  status: 'available' | 'revising'
  answer: string
}

export interface GoalUpdatedEvent {
  type: 'goal_updated'
  payload: {
    goal: {
      id: string
      objective: string
      status: 'active' | 'paused' | 'budget-limited' | 'complete' | 'dropped'
      tokensUsed?: number
      tokenBudget?: number
    } | null
    state?: { enabled?: boolean; mode?: string } | null
  }
}

/**
 * PERM-ANNOUNCE-001：内核每次改 `record.permissionMode` 都广播这一条。
 *
 * 这个字段有两个写入方（`set_permission_mode` 四档、WS「自动执行」开关走的
 * `set_auto_approve` 两态），以前谁都不通知谁：拨完开关，权限选择器还按自己 GET
 * 到的旧值渲染，显示的是内核并不在的档位。现在两个消费者都从这一条事件收敛，
 * 同一会话的另一个标签页也跟着走。
 */
export interface PermissionModeUpdatedEvent {
  type: 'permission_mode_updated'
  payload: {
    permission_mode: PermissionMode
  }
}

/**
 * ACTION-FAIL-001：会话级动作（ask_user 应答 / 自动执行开关 / 计划操作 /
 * 计划模式 / 检查点）的 RPC 失败回执。此前这五条路径的失败被
 * `.catch(() => {})` 吞掉，乐观 UI 停在错误值上、重试毫无反应。
 * 成功路径各有各的回执（permission_mode_updated / goal_updated /
 * artifact_result），失败路径统一走这一条 → 全局 toast。
 */
export interface ActionFailedEvent {
  type: 'action_failed'
  payload: {
    /** 动作的人类可读名（后端已本地化，如「自动执行开关」） */
    action: string
    message: string
  }
}

// === WebSocket 客户端 → 服务端消息 ===

export interface ChatMessage {
  type: 'chat'
  payload: {
    message: string
    turn_id?: string
    task_brief?: boolean
    /** IDEMPOTENCY-001：客户端消息幂等 id（发送失败重试复用，后端据此去重） */
    client_msg_id?: string
    /** 前端 privateMode 用：控制 localStorage 持久化，后端不需要（B2）。 */
    private?: boolean
    /** 会话级语义；per-turn 发但实际由建会时 permission_mode 决定（B2/B1）。 */
    auto_approve?: boolean
    provider_id?: string
    model_name?: string
    /** 调节 UI（ModelSettingsPanel）从未挂载，始终默认值（B2）。 */
    temperature?: number
    /** 同 temperature，孤儿 UI，始终默认值（B2）。 */
    max_tokens?: number
    /** THINKING-WIRE-001：思考开关——后端读取并传给 sidecar create_session
     *  thinking_level（OMP thinkingLevel），已真实生效。
     *  THINKING-LEVELS-001：多级字符串（off/minimal/low/medium/high/xhigh/max），
     *  兼容旧 bool（true → high / false → off）。 */
    thinking?: boolean | string
    /** 前端 ThinkPathChooser 选择；sidecar 暂未接入，不发到 OMP（B2 纠正：
     *  此前注释"the server validates it again"不实，服务端不读取此字段）。 */
    think_path_id?: 'light' | 'standard' | 'deep'
  }
}

export interface CancelMessage {
  type: 'cancel'
  payload: Record<string, never>
}

/** 心跳（`useChat.ts` 的 ping 定时器）。后端 `ping` 分支不读 payload，
 *  实际发出的帧没有 payload 字段，故声明为可选。 */
export interface PingMessage {
  type: 'ping'
  payload?: Record<string, never>
}

/** 用户对 ask_user 交互工具的响应 */
export interface UserResponseMessage {
  type: 'user_response'
  payload: {
    interaction_id: string
    response: string | string[]
  }
}

/** 会话中途更新 auto_approve 设置 */
export interface UpdateAutoApproveMessage {
  type: 'update_auto_approve'
  payload: {
    auto_approve: boolean
  }
}

export interface ArtifactActionMessage {
  type: 'artifact_action'
  payload: {
    artifact_id: string
    action_id: string
    token: string
  }
}

/** 计划卡片的用户回执（approve/modify/reject）→ 后端 plan_action RPC。 */
export interface PlanResponseMessage {
  type: 'plan_response'
  payload: {
    plan_id: string
    action: 'approve' | 'modify' | 'reject'
    modified_plan?: string
  }
}

/** 会话计划模式开关 → 后端 set_plan_mode RPC。 */
export interface SetPlanModeMessage {
  type: 'set_plan_mode'
  payload: { enabled: boolean }
}

/** 检查点保存/回退 → 后端 checkpoint_action RPC。 */
export interface CheckpointActionMessage {
  type: 'checkpoint_action'
  payload: {
    action: 'save' | 'restore'
    goal?: string
  }
}

/** 目标模式操作 → 后端 goal_action RPC（回执为 goal_updated 事件）。 */
export interface GoalActionMessage {
  type: 'goal_action'
  payload: {
    action: 'set' | 'replace' | 'pause' | 'resume' | 'drop'
    objective?: string
    token_budget?: number
  }
}

/** 流式进行中立即调整（后端 steer RPC）。 */
export interface SteerMessage {
  type: 'steer'
  payload: { message: string }
}

/** 流式进行中排入下一步的补充要求（后端 follow_up RPC）。 */
export interface FollowUpMessage {
  type: 'follow_up'
  payload: { message: string }
}

/** 回合验收：接受或带反馈重做（后端复用 chat 路径发起修订轮）。 */
export interface TaskReviewMessage {
  type: 'task_review'
  payload: {
    action: 'accept' | 'revise'
    feedback?: string
  }
}

/** 需求澄清：回答澄清问题。 */
export interface TaskBriefAnswerMessage {
  type: 'task_brief_answer'
  payload: { answer: string }
}

/** 需求澄清：按澄清后的执行提示或原始请求开跑。 */
export interface TaskBriefExecuteMessage {
  type: 'task_brief_execute'
  payload: {
    execution_prompt?: string
    use_original?: boolean
  }
}

/** 需求澄清：放弃澄清（后端补发 done{cancelled}）。 */
export interface TaskBriefCancelMessage {
  type: 'task_brief_cancel'
  payload?: Record<string, never>
}

/** 需求澄清面板的三个动作（`useChat.ts` 内部 helper 的参数类型）。 */
export type TaskBriefMessage =
  | TaskBriefAnswerMessage
  | TaskBriefExecuteMessage
  | TaskBriefCancelMessage

/**
 * ClientMessage 联合 —— 浏览器→服务端 WS 消息。
 *
 * 权威白名单是 `bun-backend/src/routes/chat-ws.ts` 的 `CLIENT_MESSAGE_TYPES`
 * （16 项）：白名单外的 type 被后端**静默丢弃**。本联合与白名单的双向对账由
 * `ClientMessage` 联合锁定（前端多发 → 后端吞掉；前端漏声明 →
 * 发送点失去类型检查）。此前联合只覆盖 6 项，另外 10 项以无类型对象字面量发出，
 * 字段拼错不会有任何提示。
 */
export type ClientMessage =
  | ChatMessage
  | CancelMessage
  | PingMessage
  | UserResponseMessage
  | UpdateAutoApproveMessage
  | ArtifactActionMessage
  | PlanResponseMessage
  | SetPlanModeMessage
  | CheckpointActionMessage
  | GoalActionMessage
  | SteerMessage
  | FollowUpMessage
  | TaskReviewMessage
  | TaskBriefAnswerMessage
  | TaskBriefExecuteMessage
  | TaskBriefCancelMessage

// === 前端 UI 状态类型 ===

export interface ThinkingBlock {
  kind: 'thinking'
  tokens: string
  done: boolean
  becameAnswer: boolean
  consumed?: boolean  // 中间思考块（工具调用前的思考），UI 不渲染
  /** CHAT-UX-002：thinking_start 到达时间戳（ms），用于计算思考耗时 */
  startedAt?: number
  /** CHAT-UX-002：思考耗时（秒，1 位小数）；完成态 header 显示「思考 · N.Ns」 */
  elapsed?: number
}

/** ask_user 交互工具在前端存储的交互数据 */
export interface AskUserInteraction {
  question: string
  /** 交互模式：qa/single_choice/multi_choice/confirm 为普通询问；approval 为工具执行审批 */
  mode: 'qa' | 'single_choice' | 'multi_choice' | 'confirm' | 'approval'
  /** 普通模式为 string[]；approval 模式为 {label,value}[] */
  options: string[] | { label: string; value: string }[]
  interactionId: string
  submitted: boolean
  code?: string
  detail?: string
  /** approval 模式：风险等级 */
  risk_level?: 'low' | 'medium' | 'high'
  /** approval 模式：工具调用参数 */
  tool_input?: Record<string, unknown>
  /** 用户审批响应，持久化在交互数据中（而非组件 local ref）。
   *  防止 DynamicScroller 销毁重建后状态丢失。 */
  responded?: 'yes' | 'no' | null
}

export interface ToolCall {
  kind: 'tool'
  name: string
  input: string
  output: string | null
  partialResult?: string
  elapsed: number | null
  status: 'running' | 'done' | 'error'
  toolData?: Record<string, unknown>
  /** ask_user 交互工具的额外数据 */
  interaction?: AskUserInteraction
}

/** 后台记忆 consumer 的 CRUD 工具调用（渲染在轮次底部小字区） */
export interface MemoryToolEvent {
  kind: 'memory_tool'
  name: string
  input: string
  output: string | null
  elapsed: number | null
  status: 'running' | 'done' | 'error'
}

/** 系统通知事件（如上下文压缩通知，渲染在轮次事件流中） */
export interface SystemTurnEvent {
  kind: 'system'
  /** 子类型，如 context_compressed */
  detail?: string
  content: string
  timestamp: number
}

export type TurnEvent = ThinkingBlock | ToolCall | MemoryToolEvent | SystemTurnEvent

export interface ChatTurn {
  id: string
  userMessage: string
  refs: ParsedRef[]
  events: TurnEvent[]
  memoryEvents?: MemoryToolEvent[]
  finalAnswer: string | null
  /** 后端生成的 turn_id，用于关联后台记忆 consumer 的事件 */
  turnId?: string
  /** Opaque IDs only; delegated task text and scope never enter the UI cache. */
  deferredRunIds?: string[]
  /** 计划卡片（plan_proposed 事件） */
  planCard?: PlanCard
  /** 情绪匹配的贴纸 URL */
  stickerUrl?: string
  /** pi 报告的每轮用量（模型 / token / 时长 / 缓存）；无 usage 的老轮次为空。 */
  usage?: TurnUsage
}

// === 会话叙事与时刻 ===

export interface NarrativeResponse {
  narrative: string
}

export interface MomentItem {
  id: string
  description: string
  theme: string
  history: Array<{ description: string; time: string }>
}

export interface MomentResponse {
  moment: MomentItem | null
}

// === Vignette：记忆分区瀑布流 ===

export interface MemoryHistoryEntry {
  description: string
  time: string
}

export interface VignetteMemoryItem {
  id: string
  description: string
  history: MemoryHistoryEntry[]
}

export interface VignetteSection {
  theme: string
  items: VignetteMemoryItem[]
}

export interface VignetteResponse {
  sections: VignetteSection[]
}

// === DeepSeek 余额 ===

export interface BalanceInfo {
  currency: string
  total_balance: string
  topped_up_balance: string
  granted_balance: string
}

export interface DeepSeekBalanceResponse {
  is_available: boolean
  balance_infos: BalanceInfo[]
}

// === 上下文窗口用量 ===

export interface BreakdownPart {
  key?: string
  label: string
  tokens: number
  count?: number  // 仅 messages 使用
}

export interface BreakdownGroup {
  total: number
  usage_percent: number
  parts: BreakdownPart[]
}

export interface TokenBreakdown {
  system_prompt: BreakdownGroup
  messages: BreakdownGroup
}

export interface ContextUsage {
  estimated_tokens?: number
  max_tokens: number
  percentage?: number
  message_count?: number
  model_name: string
  /** 兼容旧格式：由后端 context_compressed 事件映射 */
  current_tokens?: number
  usage_percent?: number
  breakdown?: TokenBreakdown
}

// === 健康检查 ===

export interface ComponentHealth {
  status: 'ok' | 'degraded' | 'error'
  latency_ms: number | null
  detail: string | null
  reason_code?: string | null
  retry_at?: number | null
  updated_at?: number | null
  summary?: string | null
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  version: string
  llm: ComponentHealth
  memory: ComponentHealth
  native_tools: ComponentHealth
  mcp_tools: ComponentHealth
  providers?: Record<string, ComponentHealth>
  ltm?: ComponentHealth & { provider_id?: string | null }
  provider_diagnostics_enabled?: boolean
  /** Server-owned feature capability for the optional ThinkPath chooser. */
  think_path_enabled?: boolean
  timestamp: number
}

// === 内置工具 ===

export interface ToolInfo {
  name: string
  label?: string
  description: string
  category?: string
  builtin?: boolean
}

export interface ListToolsResponse {
  tools: ToolInfo[]
}

// === MaxmaBlocker 拒止锚 ===

export interface BlockerEntry {
  path: string
  description: string
}

export interface ListBlockerResponse {
  entries: BlockerEntry[]
}

// === 工具环境变量 ===

export interface EnvVarItem {
  key: string
  label: string
  description: string
  apply_url: string
  value: string
  is_set: boolean
}

export interface ListEnvVarsResponse {
  env_vars: EnvVarItem[]
}

export interface UpdateEnvVarResponse {
  status: string
  key: string
  masked_value: string
}

// === Capabilities 能力仪表盘 ===

export interface CapabilitiesResponse {
  settings: Record<string, unknown>
  tools: ToolItem[]
  tool_categories: Record<string, ToolItem[]>
  mcp_servers: Record<string, unknown>[]
  discovered_mcp?: Record<string, unknown>[]
  providers: ProviderItem[]
  env: Record<string, string>
  system: Record<string, number | boolean>
  memory?: { total: number; categories: Record<string, number>; avg_confidence: number }
  plugins?: Record<string, unknown>[]
  config_sources?: {
    sources: Array<{ name: string; path: string; priority: number; exists: boolean; scope: string; description: string }>
    active_count: number
    total_count: number
    conflicts: Array<{ scope: string; sources: string[]; severity: string; note: string }>
    resolution_order: string[]
  }
  // ── Phase 4 能力发现清单（动态计算） ──
  version?: string
  features?: CapabilityFeatures
  sidecar?: SidecarStatus
  endpoints?: string[]
}

/** 单个特性的配置形状（各特性字段不同，统一为宽松记录）。 */
export type CapabilityFeatureConfig = Record<string, unknown> & { enabled?: boolean }

/** 能力发现清单的特性集合。键为特性名，值为该特性的运行时配置。 */
export interface CapabilityFeatures {
  mcp?: CapabilityFeatureConfig
  memory?: CapabilityFeatureConfig
  tts?: CapabilityFeatureConfig
  browser_tools?: CapabilityFeatureConfig
  sub_agents?: CapabilityFeatureConfig
  automation?: CapabilityFeatureConfig
  collab?: CapabilityFeatureConfig
  plugins?: CapabilityFeatureConfig
  rules?: CapabilityFeatureConfig
  tools?: CapabilityFeatureConfig
  models?: CapabilityFeatureConfig
  [key: string]: CapabilityFeatureConfig | undefined
}

/** Sidecar 运行状态。 */
export interface SidecarStatus {
  status: 'running' | 'stopped' | string
  version?: string | null
}

/** 能力发现清单（GET /api/capabilities 的 Phase 4 子集）。 */
export interface CapabilityManifest {
  version?: string
  features: CapabilityFeatures
  sidecar?: SidecarStatus
  endpoints?: string[]
}

export interface ToolItem {
  name: string
  label: string
  description: string
  category: string
  builtin: boolean
}

export interface ProviderItem {
  id: string
  name: string
  provider: string
  model: string
  enabled: boolean
}

// === Re-export 已按域拆分的类型（保持向后兼容） ===
// 以下类型的定义已迁移到独立的域文件，此处通过 re-export 保证
// 现有 `import { X } from '@/types'` 用法不破坏。
export * from './provider'
export * from './session'
export * from './mcp'
export * from './news'
export * from './metrics'
export * from './activity'
export * from './audit-log'
export * from './plugin'
export * from './collab'
