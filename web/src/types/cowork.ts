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
export type CoworkApprovalKind = 'plan' | 'tool' | 'export' | 'delete'
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

/** Maxma 任务护照：路由、审批、产物指纹与数据边界的本地凭证。 */
export interface CoworkPassportFallback {
  from_provider: string
  from_model: string
  reason: string
}

export interface CoworkPassportRoute {
  provider_id: string
  provider_label: string
  model: string
  location: string
  profile: string
  reason: string
  fallback: CoworkPassportFallback | null
  cost: {
    currency: string | null
    estimated_usd: number | null
    note: string | null
  }
  data_policy: string
}

export interface CoworkTaskPassport {
  schema: string
  brand: string
  product: string
  passport_id: string
  issued_at: string
  task: {
    id: string
    title: string
    objective: string
    status: string
    project_id: string | null
    created_at: string
    updated_at: string
    completed_at: string | null
    permission_mode: string
    data_policy: string
    model_policy: {
      profile: string
    }
  }
  execution: {
    runs: number
    latest_run: {
      attempt: number
      status: string
      started_at: string
      ended_at: string | null
      error: string | null
    } | null
    steps: {
      total: number
      completed: number
      skipped: number
      failed: number
      pending: number
      running: number
    }
  }
  route: CoworkPassportRoute | null
  approvals: {
    total: number
    pending: number
    approved: number
    rejected: number
    modified: number
    expired: number
    by_kind: {
      plan: number
      tool: number
      export: number
      delete: number
    }
    items: Array<{
      kind: string
      status: string
      created_at: string
      resolved_at: string | null
      reason: string | null
    }>
  }
  artifacts: {
    count: number
    total_bytes: number
    items: Array<{
      name: string
      path: string
      kind: string
      version: number
      size_bytes: number
      sha256: string
      status: string
    }>
  }
  source: {
    group_id: string | null
    workspace_root: string
    staging_root: string
    items: Array<{ kind: string; path: string; label: string | null }>
  }
  integrity: {
    algorithm: 'sha256'
    canonicalization: 'json-sort-keys/v1'
    digest: string
  }
}

export interface CoworkTaskPassportBundle {
  passport: CoworkTaskPassport
  markdown: string
  filenames: {
    json: string
    markdown: string
  }
}

export interface CoworkHealth {
  enabled: boolean
  tasks: number
  active_sessions: number
}

export interface CoworkProject {
  id: string
  title: string
  instructions: string
  workspace_roots_json: string
  default_template_ids_json: string
  model_policy_json: string
  data_policy: string
  created_at: string
  updated_at: string
}

export interface CoworkProjectAsset {
  id: string
  project_id: string
  path: string
  label: string
  source: string
  size_bytes: number
  created_at: string
}

export interface CoworkMemoryFact {
  id: string
  content: string
  category: string
  updatedAt: string
  scope: string
  source?: string
}

export interface CoworkProjectEvent {
  type: string
  project_id: string
  payload: Record<string, unknown>
  created_at: string
}

export interface CoworkProjectDetail {
  project: CoworkProject
  tasks: CoworkTask[]
  assets: CoworkProjectAsset[]
  memory: CoworkMemoryFact[]
  events: CoworkProjectEvent[]
}

export interface CoworkSchedule {
  id: string
  task_id: string
  task_title: string
  task_status: string
  project_id: string | null
  cron: string
  timezone: string
  enabled: number
  missed_policy: string
  next_run_at: string | null
  last_run_at: string | null
  last_status: string | null
  last_error: string | null
  last_task_run_id: string | null
  created_at: string
  updated_at: string
}

export interface CoworkSchedulePreset {
  id: string
  label: string
  cron: string
}

export interface CoworkScheduleList {
  schedules: CoworkSchedule[]
  running: boolean
  presets: CoworkSchedulePreset[]
  note: string
}

export interface CoworkConnector {
  id: string
  label: string
  kind: string
  configured: boolean
  status: 'connected' | 'unconfigured' | 'error'
  read: boolean
  write: false | 'approval'
  detail: string
  tools: string[]
  recipe?: string
}

export interface CoworkConnectorRecipe {
  id: string
  title: string
  providers: string[]
  mode: 'read-only'
  doc: string
}

export interface CoworkConnectorList {
  connectors: CoworkConnector[]
  recipes: CoworkConnectorRecipe[]
}

export type CoworkActivityEvent = CoworkEvent & {
  task_title: string
  project_id: string | null
}

export interface CreateCoworkTaskInput {
  title: string
  objective: string
  workspace_root: string
  permission_mode?: string
  project_id?: string | null
  data_policy?: string
  model_policy?: CoworkModelPolicy
  inputs?: Record<string, unknown>
}

export type CoworkModelProfile = 'private' | 'balanced' | 'quality'

export interface CoworkModelPolicy {
  profile?: CoworkModelProfile
}

export interface CoworkModelRouteSummary {
  provider_id: string
  provider_label: string
  model: string
  location: 'local' | 'cloud'
  profile: CoworkModelProfile
  fit: boolean
  reason: string
  fallback: { from_provider: string; from_model: string; reason: string } | null
  cost: {
    estimated_usd: number | null
    note: string
    pricing_known: boolean
  }
  data_policy: string
}

export interface CoworkApprovalView {
  id: string
  task_id: string
  task_title: string
  project_id: string | null
  run_id: string | null
  kind: CoworkApprovalKind
  title: string
  detail: string
  risk_level: string
  batchable: boolean
  status: CoworkApprovalStatus
  payload: Record<string, unknown>
  expires_at: string | null
  created_at: string
}

export interface CoworkApprovalList {
  approvals: CoworkApprovalView[]
  batchable_count: number
}

export interface CoworkFileBackup {
  id: string
  task_id: string
  artifact_id: string | null
  original_path: string
  backup_path: string
  sha256: string
  size_bytes: number
  reason: string
  created_at: string
  restored_at: string | null
}

export interface CoworkExportResult {
  path: string
  versioned: boolean
  backup_id: string
  sha256: string
  size_bytes: number
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
