/**
 * api/cowork.ts — Cowork 任务域请求分片。
 *
 * 事件流是任务级 SSE：浏览器 EventSource 带 `Last-Event-ID` 自动续传，
 * token 走 query（EventSource 不能设自定义头，与后端 middleware 约定一致）。
 */

import type {
  CreateCoworkTaskInput,
  CoworkHealth,
  CoworkTask,
  CoworkTaskDetail,
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

export function coworkArtifactUrl(taskId: string, artifactId: string, token: string): string {
  const params = new URLSearchParams({ token })
  return `${getApiBase()}/cowork/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/file?${params.toString()}`
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

    decideCoworkApproval: (id: string, decision: CoworkApprovalDecision) =>
      request<CoworkTaskDetail>(`/cowork/approvals/${encodeURIComponent(id)}/decide`, {
        method: 'POST',
        body: JSON.stringify(decision),
      }),

    /** 交给组件创建 EventSource；token 必须先 ensureTokenLoaded。 */
    prepareCoworkEvents: async (taskId: string, after = 0): Promise<string> => {
      await ensureTokenLoaded()
      return coworkEventsUrl(taskId, getToken(), after)
    },

    prepareCoworkArtifact: async (taskId: string, artifactId: string): Promise<string> => {
      await ensureTokenLoaded()
      return coworkArtifactUrl(taskId, artifactId, getToken())
    },
  }
}
