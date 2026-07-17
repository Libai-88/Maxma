/** 会话（Session）与延迟任务（Deferred Run）类型定义 */

export interface SessionInfo {
  session_id: string
  message_count: number
  created_at: number
  last_active?: number
  has_active_agent?: boolean
  is_subagent?: boolean
  auto_approve?: boolean
  is_const?: boolean
  const_name?: string
}

export interface CreateSessionResponse {
  session_id: string
  created_at: number
}

export interface ConstifyResponse {
  session_id: string
  is_const: boolean
  const_name: string
}

export interface ListSessionsResponse {
  sessions: SessionInfo[]
}

/** Additional session-scoped restriction; it never replaces server-side safeguards. */
export type PermissionMode = 'read_only' | 'ask' | 'operate' | 'auto'

/** Server-owned feature flag and effective permission mode for one session. */
export interface SessionPermissionModeResponse {
  session_id: string
  permission_modes_enabled: boolean
  permission_mode: PermissionMode
  permission_mode_updated_at: number
  available_permission_modes: PermissionMode[]
}

export type DeferredRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Browser-safe projection returned by the deferred-runs API. */
export interface DeferredRun {
  run_id: string
  parent_turn_id: string | null
  status: DeferredRunStatus
  result_ref: string | null
  result: string | null
  cancel_reason: 'cancelled_by_user' | 'parent_session_closed' | 'cancelled' | null
  deadline_at: number | null
  attempts: number
  created_at: number
  updated_at: number
  error_code?: 'deferred_run_failed'
}

export interface ListDeferredRunsResponse {
  runs: DeferredRun[]
}
