/** Workflow（工作流）运行态类型定义 */

/** Browser-safe, server-owned workflow state. Checkpoints and handler details stay server-side. */
export type WorkflowRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface WorkflowStepSummary {
  step_id: string
  position: number
  status: WorkflowRunStatus
  attempts: number
  checkpoint: Record<string, unknown> | null
}

export interface WorkflowRun {
  run_id: string
  parent_turn_id: string | null
  workflow_id: string
  workflow_version: number
  status: WorkflowRunStatus
  current_step_id: string | null
  failure_code: string | null
  cancel_reason: 'cancelled_by_user' | 'parent_session_closed' | 'cancelled' | null
  created_at: number
  updated_at: number
  steps?: WorkflowStepSummary[]
}

export interface WorkflowDefinitionsResponse {
  workflow_ids: string[]
}

export interface ListWorkflowRunsResponse {
  runs: WorkflowRun[]
}
