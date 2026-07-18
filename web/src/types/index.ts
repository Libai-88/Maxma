import type { ParsedRef } from '@/utils/references'

import type { InteractiveArtifact } from './workbench'

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

export interface AnswerEvent {
  type: 'answer'
  payload: { content: string }
}

export interface DoneEvent {
  type: 'done'
  payload: { turn_id?: string; context_usage?: ContextUsage }
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
  }
}

export interface PongEvent {
  type: 'pong'
  payload: Record<string, never>
}

export interface ContextUsageEvent {
  type: 'context_usage'
  payload: ContextUsage
}

/** 会话上下文压缩事件（手动压缩或自动压缩完成时推送） */
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
    /** approval 模式：风险等级 */
    risk_level?: 'low' | 'medium' | 'high'
    /** approval 模式：工具调用参数 */
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

/** plan_proposed — Planner 生成计划后等待用户确认 */
export interface PlanProposedEvent {
  type: 'plan_proposed'
  payload: {
    plan_id: string
    steps: string[]
    plan_text: string
  }
}

/** plan_step_start — executor 开始执行某步骤 */
export interface PlanStepStartEvent {
  type: 'plan_step_start'
  payload: {
    step_index: number
    step_description: string
    tool_hint?: string
    total_steps: number
  }
}

/** plan_step_end — executor 完成某步骤 */
export interface PlanStepEndEvent {
  type: 'plan_step_end'
  payload: {
    step_index: number
    step_description: string
    status: 'done' | 'skipped'
  }
}

/** plan_step_error — executor 某步骤失败 */
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

/** plan_completed — 全部步骤执行完成 */
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

/** sub_session_created — 主 Agent 调用 call_sub_agent 后推送 */
export interface SubSessionCreatedEvent {
  type: 'sub_session_created'
  payload: {
    sub_session_id: string
    parent_session_id: string | null
    task: string
    name: string
  }
}

/** Browser receives only an opaque run ID for an async delegation. */
export interface DeferredSubagentSubmittedEvent {
  type: 'deferred_subagent_submitted'
  payload: {
    run_id: string
    parent_session_id: string | null
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  }
}

/** A structured card. The client renders only local allow-listed components. */
export interface ArtifactEvent {
  type: 'artifact'
  payload: InteractiveArtifact
}

/** memory_tool_start — 后台记忆 consumer 开始调用 CRUD 工具 */
export interface MemoryToolStartEvent {
  type: 'memory_tool_start'
  payload: {
    turn_id: string
    tool_name: string
    input: string
  }
}

/** memory_tool_end — 后台记忆 consumer 的 CRUD 工具执行完毕 */
export interface MemoryToolEndEvent {
  type: 'memory_tool_end'
  payload: {
    turn_id: string
    tool_name: string
    output: string
    elapsed: number
  }
}

/** memory_tool_error — 后台记忆 consumer 的 CRUD 工具执行出错 */
export interface MemoryToolErrorEvent {
  type: 'memory_tool_error'
  payload: {
    turn_id: string
    tool_name: string
    error: string
  }
}

/** memory_start — 后台记忆 consumer 开始处理本轮对话 */
export interface MemoryStartEvent {
  type: 'memory_start'
  payload: {
    turn_id: string
  }
}

/** memory_done — 后台记忆 consumer 处理完毕（无论是否有修改） */
export interface MemoryDoneEvent {
  type: 'memory_done'
  payload: {
    turn_id: string
  }
}

export type ServerEvent =
  | ThinkingStartEvent
  | TokenEvent
  | ThinkingEndEvent
  | ThinkingDeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | ToolErrorEvent
  | AnswerEvent
  | DoneEvent
  | ErrorEvent
  | PongEvent
  | ContextUsageEvent
  | ContextCompressedEvent
  | ArtifactEvent
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

// === WebSocket 客户端 → 服务端消息 ===

export interface ChatMessage {
  type: 'chat'
  payload: {
    message: string
    private?: boolean
    auto_approve?: boolean
    provider_id?: string
    model_name?: string
    temperature?: number
    max_tokens?: number
    /** A fixed, user-confirmed ThinkPath ID; the server validates it again. */
    think_path_id?: 'light' | 'standard' | 'deep'
  }
}

export interface CancelMessage {
  type: 'cancel'
  payload: Record<string, never>
}

export interface PingMessage {
  type: 'ping'
  payload: Record<string, never>
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

export type ClientMessage = ChatMessage | CancelMessage | PingMessage | UserResponseMessage | UpdateAutoApproveMessage | ArtifactActionMessage

// === 前端 UI 状态类型 ===

export interface ThinkingBlock {
  kind: 'thinking'
  tokens: string
  done: boolean
  becameAnswer: boolean
  consumed?: boolean  // 中间思考块（工具调用前的思考），UI 不渲染
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
}

export interface ToolCall {
  kind: 'tool'
  name: string
  input: string
  output: string | null
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
  anthropic_skills_count: number
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
  description: string
}

export interface ListToolsResponse {
  tools: ToolInfo[]
}

// === 路径白名单 ===

export interface WhitelistEntry {
  path: string
  description: string
  recursive: boolean
}

export interface ListWhitelistResponse {
  entries: WhitelistEntry[]
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

// === Re-export 已按域拆分的类型（保持向后兼容） ===
// 以下类型的定义已迁移到独立的域文件，此处通过 re-export 保证
// 现有 `import { X } from '@/types'` 用法不破坏。
export * from './provider'
export * from './session'
export * from './workflow'
export * from './mcp'
export * from './news'
export * from './skills'
export * from './metrics'
export * from './activity'
export * from './audit-log'
