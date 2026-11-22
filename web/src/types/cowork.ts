/**
 * Cowork 任务域类型（M1）。
 *
 * 与后端 `bun-backend/src/services/cowork-store.ts` 的持久化行一一对应；
 * UI 不发明第二套状态，只消费这些字段。
 */

export type CoworkTaskStatus =
  | 'draft'
  | 'planning'
  | 'awaiting_plan'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'review'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type CoworkRunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type CoworkStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type CoworkApprovalKind = 'plan' | 'tool'
export type CoworkApprovalStatus = 'pending' | 'approved' | 'rejected' | 'modified' | 'expired'

export interface CoworkTask {
  id: string
  project_id: string | null
  title: string
  objective: string
  status: CoworkTaskStatus
  workspace_root: string
  staging_root: string
  permission_mode: string
  model_policy_json: string
  data_policy: string
  inputs_json: string
  session_id: string | null
  schedule_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface CoworkRun {
  id: string
  task_id: string
  attempt: number
  status: CoworkRunStatus
  started_at: string
  ended_at: string | null
  error: string | null
  checkpoint_json: string
  usage_json: string
}

export interface CoworkStep {
  id: string
  run_id: string
  seq: number
  label: string
  status: CoworkStepStatus
  detail_json: string
  started_at: string | null
  ended_at: string | null
}

export interface CoworkArtifact {
  id: string
  task_id: string
  run_id: string | null
  kind: string
  path: string
  version: number
  sha256: string
  size_bytes: number
  template_id: string | null
  status: string
  sources_json: string
  created_at: string
}

export interface CoworkApproval {
  id: string
  task_id: string
  run_id: string | null
  kind: CoworkApprovalKind
  payload_json: string
  status: CoworkApprovalStatus
  decision_reason: string | null
  expires_at: string | null
  created_at: string
  resolved_at: string | null
}

export interface CoworkEvent {
  id: number
  task_id: string
  run_id: string | null
  type: string
  payload_json: string
  created_at: string
  /** SSE/历史接口解析后的 payload；列表接口可能只有 payload_json。 */
  payload?: Record<string, unknown>
}

export interface CoworkTaskDetail {
  task: CoworkTask
  runs: CoworkRun[]
  steps: CoworkStep[]
  artifacts: CoworkArtifact[]
  approvals: CoworkApproval[]
  events: CoworkEvent[]
  latest_run: CoworkRun | null
}

export interface CoworkHealth {
  enabled: boolean
  tasks: number
  active_sessions: number
}

export interface CreateCoworkTaskInput {
  title: string
  objective: string
  workspace_root: string
  permission_mode?: string
  inputs?: Record<string, unknown>
}

export interface CoworkPlanPayload {
  plan_id?: string
  plan_text?: string
  steps?: string[]
}

export interface CoworkToolPayload {
  interaction_id?: string
  tool_name?: string
  tool_call_id?: string
  question?: string
  risk_level?: string
  options?: unknown[]
  tool_input?: string
}
