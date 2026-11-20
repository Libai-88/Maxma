/**
 * api/workspace.ts — 工作区文件面板的 API 分片。
 *
 * 从 api/index.ts 拆出来，避免主 API 文件继续变胖（体量棘轮上限 800 行，
 * 存量 api/index.ts 已有 1095 行基线）。这里只做请求拼装，安全边界仍在后端。
 */

import type {
  CommandResult,
  GitCommitResult,
  GitDiffResult,
  GitStatusResult,
  WorkspaceRoot,
  WorkspaceTextFile,
  WorkspaceTreeEntry,
  WorkspaceTreeResult,
} from '@/types/workspace'
import { getApiBase } from '@/utils/env'

interface WorkspaceApiDeps {
  request: <T>(url: string, options?: RequestInit) => Promise<T>
  getToken: () => string
  ensureTokenLoaded: () => Promise<void>
}

const BASE = getApiBase()

export function createWorkspaceApi({ request, getToken, ensureTokenLoaded }: WorkspaceApiDeps) {
  return {
    listWorkspaceRoots: () =>
      request<{ roots: WorkspaceRoot[] }>('/workspace/roots'),

    addWorkspaceRoot: (path: string, label?: string) =>
      request<{ root: WorkspaceRoot }>('/workspace/roots', {
        method: 'POST',
        body: JSON.stringify({ path, label }),
      }),

    removeWorkspaceRoot: (id: string) =>
      request<{ removed: WorkspaceRoot }>(`/workspace/roots/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),

    renameWorkspaceRoot: (id: string, label: string) =>
      request<{ root: WorkspaceRoot }>(`/workspace/roots/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ label }),
      }),

    workspaceTree: (rootId: string, path = '', showIgnored = false) => {
      const params = new URLSearchParams({ root_id: rootId, path })
      if (showIgnored) params.set('show_ignored', '1')
      return request<WorkspaceTreeResult>(`/workspace/tree?${params.toString()}`)
    },

    workspaceWrite: (rootId: string, path: string, content: string, baseHash: string) =>
      request<{ file: WorkspaceTextFile }>('/workspace/file', {
        method: 'PUT',
        body: JSON.stringify({ root_id: rootId, path, content, base_hash: baseHash }),
      }),

    workspaceRun: (rootId: string, command: string, timeoutMs = 60000) =>
      request<CommandResult>('/workspace/run', {
        method: 'POST',
        body: JSON.stringify({ root_id: rootId, command, timeout_ms: timeoutMs }),
      }),

    gitStatus: (rootId: string) =>
      request<GitStatusResult>(`/git/status?root_id=${encodeURIComponent(rootId)}`),

    gitDiff: (rootId: string, path: string, staged = false) => {
      const params = new URLSearchParams({ root_id: rootId, path })
      if (staged) params.set('staged', '1')
      return request<GitDiffResult>(`/git/diff?${params.toString()}`)
    },

    gitStage: (rootId: string, paths: string[]) =>
      request<GitStatusResult>('/git/stage', {
        method: 'POST',
        body: JSON.stringify({ root_id: rootId, paths }),
      }),

    gitUnstage: (rootId: string, paths: string[]) =>
      request<GitStatusResult>('/git/unstage', {
        method: 'POST',
        body: JSON.stringify({ root_id: rootId, paths }),
      }),

    gitCommit: (rootId: string, message: string) =>
      request<GitCommitResult>('/git/commit', {
        method: 'POST',
        body: JSON.stringify({ root_id: rootId, message, confirm: true }),
      }),

    workspaceSearch: (rootId: string, q: string, showIgnored = false) => {
      const params = new URLSearchParams({ root_id: rootId, q })
      if (showIgnored) params.set('show_ignored', '1')
      return request<{ query: string; entries: WorkspaceTreeEntry[]; truncated: boolean; scanned: number }>(
        `/workspace/search?${params.toString()}`,
      )
    },

    workspaceFile: (rootId: string, path: string) => {
      const params = new URLSearchParams({ root_id: rootId, path })
      return request<{ file: WorkspaceTextFile }>(`/workspace/file?${params.toString()}`)
    },

    workspaceBlob: async (rootId: string, path: string): Promise<Blob> => {
      await ensureTokenLoaded()
      const params = new URLSearchParams({ root_id: rootId, path })
      const token = getToken()
      const res = await fetch(`${BASE}/workspace/blob?${params.toString()}`, {
        headers: token ? { 'X-Maxma-Token': token } : undefined,
      })
      if (!res.ok) {
        let message = `文件读取失败 (${res.status})`
        try {
          const body = await res.json() as { error?: { message?: unknown } }
          if (typeof body.error?.message === 'string') message = body.error.message
        } catch { /* 二进制错误体或空体 */ }
        throw new Error(message)
      }
      return res.blob()
    },
  }
}
