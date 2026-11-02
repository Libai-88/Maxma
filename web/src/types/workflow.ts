/**
 * Workflow（工作流）运行态类型定义
 *
 * 对应 `bun-backend/src/routes/workflows.ts` 挂载的 REST 端点
 * （`/api/workflows/definitions`、`/api/sessions/:id/workflows[/:runId]`）。
 * 截至 2026-11-02：web/src 里**零消费者**——`api/index.ts` 没有对应方法，
 * 也没有任何 view/component 读取运行态。保留是因为后端端点真实存在，
 * 一旦接 UI 就是这些形状；在此之前请勿据以认为工作流功能可用
 * （WS 侧的 workflow_* 事件同样没人接，见 types/index.ts 的 ServerEvent 注释）。
 */

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
