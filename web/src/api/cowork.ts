/**
 * api/cowork.ts — Cowork 任务域请求分片。
 *
 * 事件流是任务级 SSE：浏览器 EventSource 带 `Last-Event-ID` 自动续传，
 * token 走 query（EventSource 不能设自定义头，与后端 middleware 约定一致）。
 */

import type {
  CreateCoworkTaskInput,
  CoworkActivityEvent,
  CoworkApprovalList,
  CoworkConnectorList,
  CoworkFileBackup,
  CoworkHealth,
  CoworkMemoryFact,
  CoworkModelPolicy,
  CoworkModelRouteSummary,
  CoworkProject,
  CoworkProjectAsset,
  CoworkProjectDetail,
  CoworkSchedule,
  CoworkScheduleList,
  CoworkTask,
  CoworkTaskDetail,
  CoworkTaskPassportBundle,
} from '@/types/cowork'
import { getApiBase } from '@/utils/env'

interface CoworkApiDeps {
  request: <T>(url: string, options?: RequestInit) => Promise<T>
  getToken: () => string
  ensureTokenLoaded: () => Promise<void>
}

export interface CoworkApprovalDecision {
  action: 'approve' | 'reject' | 'modify'
  reason?: string
  modified_plan?: string
}

export function coworkEventsUrl(taskId: string, token: string, after = 0): string {
  const params = new URLSearchParams({ token })
  if (after > 0) params.set('after', String(after))
  return `${getApiBase()}/cowork/tasks/${encodeURIComponent(taskId)}/events?${params.toString()}`
}

export function coworkArtifactUrl(taskId: string, artifactId: string, token: string, inline = false): string {
  const params = new URLSearchParams({ token })
  if (inline) params.set('inline', '1')
  return `${getApiBase()}/cowork/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/file?${params.toString()}`
}

export function coworkPackageUrl(taskId: string, token: string): string {
  return `${getApiBase()}/cowork/tasks/${encodeURIComponent(taskId)}/package?${new URLSearchParams({ token }).toString()}`
}

export function createCoworkApi({ request, getToken, ensureTokenLoaded }: CoworkApiDeps) {
  return {
    coworkHealth: () => request<CoworkHealth>('/cowork/health'),

    listCoworkTasks: () => request<{ tasks: CoworkTask[] }>('/cowork/tasks'),

    createCoworkTask: (input: CreateCoworkTaskInput) =>
      request<{ task: CoworkTask }>('/cowork/tasks', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    getCoworkTask: (id: string) =>
      request<CoworkTaskDetail>(`/cowork/tasks/${encodeURIComponent(id)}`),

    getCoworkTaskPassport: (id: string) =>
      request<CoworkTaskPassportBundle>(`/cowork/tasks/${encodeURIComponent(id)}/passport`),

    startCoworkTask: (id: string) =>
      request<{ task: CoworkTask; run_id: string }>(`/cowork/tasks/${encodeURIComponent(id)}/run`, {
        method: 'POST',
      }),

    pauseCoworkTask: (id: string) =>
      request<{ task: CoworkTask }>(`/cowork/tasks/${encodeURIComponent(id)}/pause`, {
        method: 'POST',
      }),

    resumeCoworkTask: (id: string) =>
      request<{ task: CoworkTask; run_id: string }>(`/cowork/tasks/${encodeURIComponent(id)}/resume`, {
        method: 'POST',
      }),

    cancelCoworkTask: (id: string) =>
      request<{ task: CoworkTask }>(`/cowork/tasks/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
      }),

    acceptCoworkTask: (id: string) =>
      request<{ task: CoworkTask }>(`/cowork/tasks/${encodeURIComponent(id)}/accept`, {
        method: 'POST',
      }),

    reviseCoworkTask: (id: string, input: {
      artifact_id: string
      instruction: string
      selection: Record<string, unknown>
    }) =>
      request<{ task: CoworkTask; run_id: string }>(`/cowork/tasks/${encodeURIComponent(id)}/revise`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    decideCoworkApproval: (id: string, decision: CoworkApprovalDecision) =>
      request<CoworkTaskDetail>(`/cowork/approvals/${encodeURIComponent(id)}/decide`, {
        method: 'POST',
        body: JSON.stringify(decision),
      }),

    // ── M4 审批中心 / 数据边界 / 交付 ──
    listCoworkApprovals: (options: { status?: string; taskId?: string } = {}) => {
      const params = new URLSearchParams({ status: options.status ?? 'pending' })
      if (options.taskId) params.set('task_id', options.taskId)
      return request<CoworkApprovalList>(`/cowork/approvals?${params.toString()}`)
    },

    batchCoworkApprovals: (ids: string[]) =>
      request<{ approved: number }>('/cowork/approvals/batch', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),

    previewCoworkModelRoute: (input: {
      project_id?: string | null
      task_id?: string
      data_policy?: string
      model_policy?: CoworkModelPolicy
      prompt_chars?: number
      long_document?: boolean
    }) =>
      request<{ route: CoworkModelRouteSummary; data_policy: string }>('/cowork/model-route/preview', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    requestCoworkArtifactExport: (taskId: string, artifactId: string) =>
      request<{ approval: CoworkApprovalList['approvals'][number] }>(
        `/cowork/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/export`,
        { method: 'POST', body: JSON.stringify({}) },
      ),

    requestCoworkArtifactDelete: (taskId: string, artifactId: string) =>
      request<{ approval: CoworkApprovalList['approvals'][number] }>(
        `/cowork/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/delete`,
        { method: 'POST', body: JSON.stringify({}) },
      ),

    listCoworkFileBackups: (taskId: string) =>
      request<{ backups: CoworkFileBackup[] }>(`/cowork/tasks/${encodeURIComponent(taskId)}/file-backups`),

    restoreCoworkFileBackup: (backupId: string) =>
      request<{ backup: CoworkFileBackup }>(`/cowork/file-backups/${encodeURIComponent(backupId)}/restore`, {
        method: 'POST',
      }),

    prepareCoworkPackage: async (taskId: string): Promise<string> => {
      await ensureTokenLoaded()
      return coworkPackageUrl(taskId, getToken())
    },

    // ── M3 项目 / 资产 / 记忆 ──
    listCoworkProjects: () => request<{ projects: CoworkProject[] }>('/cowork/projects'),

    createCoworkProject: (input: {
      title: string
      instructions?: string
      workspace_roots?: string[]
      data_policy?: string
    }) => request<{ project: CoworkProject }>('/cowork/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

    getCoworkProject: (id: string) =>
      request<CoworkProjectDetail>(`/cowork/projects/${encodeURIComponent(id)}`),

    updateCoworkProject: (id: string, input: {
      title?: string
      instructions?: string
      workspace_roots?: string[]
      data_policy?: string
    }) => request<{ project: CoworkProject }>(`/cowork/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

    addCoworkProjectAsset: (id: string, input: { path: string; label?: string }) =>
      request<{ asset: CoworkProjectAsset }>(`/cowork/projects/${encodeURIComponent(id)}/assets`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    removeCoworkProjectAsset: (id: string, assetId: string) =>
      request<{ ok: boolean }>(`/cowork/projects/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`, {
        method: 'DELETE',
      }),

    attachCoworkProjectAsset: (id: string, assetId: string, taskId: string) =>
      request<{ task: CoworkTask }>(`/cowork/projects/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}/attach`, {
        method: 'POST',
        body: JSON.stringify({ task_id: taskId }),
      }),

    searchCoworkProjectMemory: (id: string, query = '') =>
      request<{ memory: CoworkMemoryFact[] }>(`/cowork/projects/${encodeURIComponent(id)}/memory?q=${encodeURIComponent(query)}`),

    addCoworkProjectMemory: (id: string, content: string, category = '任务摘要') =>
      request<{ memory: CoworkMemoryFact }>(`/cowork/projects/${encodeURIComponent(id)}/memory`, {
        method: 'POST',
        body: JSON.stringify({ content, category, confirmed: true }),
      }),

    // ── M3 定时 ──
    listCoworkSchedules: (projectId?: string) =>
      request<CoworkScheduleList>(`/cowork/schedules${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`),

    createCoworkSchedule: (input: {
      task_id: string
      cron: string
      timezone?: string
      missed_policy?: string
    }) => request<{ schedule: CoworkSchedule }>('/cowork/schedules', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

    updateCoworkSchedule: (id: string, input: {
      cron?: string
      timezone?: string
      missed_policy?: string
      enabled?: boolean
    }) => request<{ schedule: CoworkSchedule }>(`/cowork/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

    deleteCoworkSchedule: (id: string) =>
      request<{ ok: boolean }>(`/cowork/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    // ── M3 连接器 / 活动 ──
    coworkConnectors: () => request<CoworkConnectorList>('/cowork/connectors'),

    coworkActivity: (limit = 60) =>
      request<{ activity: CoworkActivityEvent[] }>(`/cowork/activity?limit=${limit}`),

    /** 交给组件创建 EventSource；token 必须先 ensureTokenLoaded。 */
    prepareCoworkEvents: async (taskId: string, after = 0): Promise<string> => {
      await ensureTokenLoaded()
      return coworkEventsUrl(taskId, getToken(), after)
    },

    prepareCoworkArtifact: async (taskId: string, artifactId: string, inline = false): Promise<string> => {
      await ensureTokenLoaded()
      return coworkArtifactUrl(taskId, artifactId, getToken(), inline)
    },
  }
}
