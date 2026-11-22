/**
 * Cowork 任务 Store（M1）。
 *
 * 任务状态只以后端任务表为准：SSE 事件只负责触发“重新读详情”，不在前端
 * 自己拼状态机。这样刷新页面、断线重连、应用重启后看到的都是同一份事实。
 */

import { create } from 'zustand'

import { api } from '@/api'
import { createLogger } from '@/utils/logger'
import { maybeNotifyCowork } from '@/utils/coworkNotify'
import type {
  CoworkApproval,
  CoworkApprovalView,
  CoworkEvent,
  CoworkFileBackup,
  CoworkHealth,
  CoworkModelPolicy,
  CoworkTask,
  CoworkTaskDetail,
} from '@/types/cowork'

const log = createLogger('cowork')

export type CoworkConnection = 'idle' | 'connecting' | 'open' | 'reconnecting'

export const COWORK_STATUS_LABELS: Record<string, string> = {
  draft: '待启动',
  planning: '正在计划',
  awaiting_plan: '待批准计划',
  running: '执行中',
  awaiting_approval: '待批准操作',
  paused: '已暂停',
  review: '待验收',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export const COWORK_STEP_LABELS: Record<string, string> = {
  pending: '待执行',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  skipped: '跳过',
}

export const COWORK_APPROVAL_LABELS: Record<string, string> = {
  plan: '计划',
  tool: '工具操作',
  export: '导出到工作区',
  delete: '删除产物',
}

export function coworkStatusLabel(status: string): string {
  return COWORK_STATUS_LABELS[status] ?? status
}

export function coworkStepLabel(status: string): string {
  return COWORK_STEP_LABELS[status] ?? status
}

export function isPlanApproval(approval: CoworkApproval): boolean {
  return approval.kind === 'plan'
}

export function pendingApprovals(detail: CoworkTaskDetail | null): CoworkApproval[] {
  return (detail?.approvals ?? []).filter((approval) => approval.status === 'pending')
}

function parsePayload(json: string | undefined): Record<string, unknown> {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function approvalPayload(approval: CoworkApproval): Record<string, unknown> {
  return parsePayload(approval.payload_json)
}

interface CoworkState {
  health: CoworkHealth | null
  tasks: CoworkTask[]
  detail: CoworkTaskDetail | null
  selectedId: string | null
  approvals: CoworkApprovalView[]
  approvalsLoading: boolean
  fileBackups: CoworkFileBackup[]
  loading: boolean
  detailLoading: boolean
  error: string
  action: string
  connection: CoworkConnection
  lastEventId: number
  fetchHealth: () => Promise<void>
  fetchTasks: () => Promise<void>
  fetchApprovals: (status?: string) => Promise<void>
  batchApprove: (ids: string[]) => Promise<void>
  fetchFileBackups: () => Promise<void>
  restoreFileBackup: (id: string) => Promise<void>
  requestArtifactExport: (artifactId: string) => Promise<CoworkApprovalView | null>
  requestArtifactDelete: (artifactId: string) => Promise<CoworkApprovalView | null>
  selectTask: (id: string | null) => Promise<void>
  refreshDetail: () => Promise<void>
  createTask: (input: {
    title: string
    objective: string
    workspace_root: string
    permission_mode?: string
    project_id?: string | null
    data_policy?: string
    model_policy?: CoworkModelPolicy
  }) => Promise<CoworkTask>
  runTask: () => Promise<void>
  pauseTask: () => Promise<void>
  resumeTask: () => Promise<void>
  cancelTask: () => Promise<void>
  acceptTask: () => Promise<void>
  reviseTask: (input: {
    artifact_id: string
    instruction: string
    selection: Record<string, unknown>
  }) => Promise<void>
  decideApproval: (
    approvalId: string,
    action: 'approve' | 'reject' | 'modify',
    options?: { reason?: string; modified_plan?: string },
  ) => Promise<void>
  connect: (taskId: string) => Promise<void>
  disconnect: () => void
}

export const useCoworkStore = create<CoworkState>()((set, get) => {
  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let detailRequest = 0
  let streamedTaskId: string | null = null

  function stopStream(): void {
    if (source) {
      source.close()
      source = null
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void get().refreshDetail()
      void get().fetchTasks()
    }, 300)
  }

  async function connect(taskId: string): Promise<void> {
    const tokenTask = taskId
    stopStream()
    streamedTaskId = tokenTask
    set({ connection: 'connecting' })
    try {
      const url = await api.prepareCoworkEvents(tokenTask, get().lastEventId)
      if (streamedTaskId !== tokenTask) return
      source = new EventSource(url)
      source.addEventListener('open', () => {
        if (streamedTaskId !== tokenTask) return
        set({ connection: 'open' })
      })
      source.addEventListener('cowork', (event) => {
        if (streamedTaskId !== tokenTask) return
        try {
          const parsed = JSON.parse((event as MessageEvent).data) as CoworkEvent
          if (typeof parsed.id === 'number') set({ lastEventId: Math.max(get().lastEventId, parsed.id) })
          maybeNotifyCowork(parsed)
        } catch {
          // 事件体损坏不阻断流；详情刷新仍会读 DB
        }
        scheduleRefresh()
      })
      source.addEventListener('error', () => {
        if (streamedTaskId !== tokenTask) return
        set({ connection: 'reconnecting' })
        // EventSource 会自己重连；但 401/服务端关闭时它可能进入 CLOSED，
        // 这时按当前游标手动重建，避免界面永远停在“重连中”。
        if (source && source.readyState === EventSource.CLOSED) {
          source.close()
          source = null
          if (reconnectTimer) clearTimeout(reconnectTimer)
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            if (streamedTaskId === tokenTask) void connect(tokenTask)
          }, 2000)
        }
      })
    } catch (err) {
      set({ connection: 'reconnecting', error: err instanceof Error ? err.message : String(err) })
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (streamedTaskId === tokenTask) void connect(tokenTask)
      }, 2000)
    }
  }

  async function fetchTasks(): Promise<void> {
    set({ loading: true, error: '' })
    try {
      const { tasks } = await api.listCoworkTasks()
      set({ tasks })
      const selected = get().selectedId
      if (selected && !tasks.some((task) => task.id === selected)) {
        set({ selectedId: null, detail: null })
        get().disconnect()
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loading: false })
    }
  }

  async function fetchHealth(): Promise<void> {
    try {
      set({ health: await api.coworkHealth() })
    } catch (err) {
      log.warn('cowork health failed:', err instanceof Error ? err.message : String(err))
    }
  }

  async function refreshDetail(): Promise<void> {
    const id = get().selectedId
    if (!id) {
      set({ detail: null })
      return
    }
    const requestId = ++detailRequest
    set({ detailLoading: true })
    try {
      const detail = await api.getCoworkTask(id)
      if (requestId !== detailRequest || get().selectedId !== id) return
      set({ detail, error: '' })
    } catch (err) {
      if (requestId !== detailRequest) return
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (requestId === detailRequest) set({ detailLoading: false })
    }
  }

  async function selectTask(id: string | null): Promise<void> {
    stopStream()
    streamedTaskId = id
    if (!id) {
      set({ selectedId: null, detail: null, connection: 'idle', lastEventId: 0, fileBackups: [] })
      return
    }
    set({
      selectedId: id,
      detail: null,
      detailLoading: true,
      connection: 'connecting',
      lastEventId: 0,
      fileBackups: [],
    })
    await get().refreshDetail()
    await get().fetchFileBackups()
    await connect(id)
  }

  async function withAction(action: string, fn: () => Promise<void>): Promise<void> {
    if (get().action) return
    set({ action, error: '' })
    try {
      await fn()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ action: '' })
    }
  }

  return {
    health: null,
    tasks: [],
    detail: null,
    selectedId: null,
    approvals: [],
    approvalsLoading: false,
    fileBackups: [],
    loading: false,
    detailLoading: false,
    error: '',
    action: '',
    connection: 'idle',
    lastEventId: 0,

    fetchHealth,
    fetchTasks,

    fetchApprovals: async (status = 'pending') => {
      set({ approvalsLoading: true })
      try {
        const result = await api.listCoworkApprovals({ status })
        set({ approvals: result.approvals })
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      } finally {
        set({ approvalsLoading: false })
      }
    },

    batchApprove: (ids) => withAction('approval:batch', async () => {
      await api.batchCoworkApprovals(ids)
      await get().fetchApprovals()
      await get().refreshDetail()
      await get().fetchTasks()
    }),

    fetchFileBackups: async () => {
      const id = get().selectedId
      if (!id) {
        set({ fileBackups: [] })
        return
      }
      try {
        const result = await api.listCoworkFileBackups(id)
        if (get().selectedId === id) set({ fileBackups: result.backups })
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      }
    },

    restoreFileBackup: (id) => withAction(`restore:${id}`, async () => {
      await api.restoreCoworkFileBackup(id)
      await get().fetchFileBackups()
      await get().refreshDetail()
    }),

    requestArtifactExport: async (artifactId) => {
      const taskId = get().selectedId
      if (!taskId) return null
      try {
        const { approval } = await api.requestCoworkArtifactExport(taskId, artifactId)
        set({ error: '' })
        await get().refreshDetail()
        await get().fetchApprovals()
        return approval
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
        return null
      }
    },

    requestArtifactDelete: async (artifactId) => {
      const taskId = get().selectedId
      if (!taskId) return null
      try {
        const { approval } = await api.requestCoworkArtifactDelete(taskId, artifactId)
        set({ error: '' })
        await get().refreshDetail()
        await get().fetchApprovals()
        return approval
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
        return null
      }
    },

    selectTask,

    refreshDetail,

    createTask: async (input) => {
      const { task } = await api.createCoworkTask(input)
      await get().fetchTasks()
      await get().selectTask(task.id)
      return task
    },

    runTask: () => withAction('run', async () => {
      const id = get().selectedId
      if (!id) return
      const result = await api.startCoworkTask(id)
      await get().fetchTasks()
      await get().refreshDetail()
      set({ error: '' })
      if (result.run_id) await connect(id)
    }),

    pauseTask: () => withAction('pause', async () => {
      const id = get().selectedId
      if (!id) return
      await api.pauseCoworkTask(id)
      await get().refreshDetail()
      await get().fetchTasks()
    }),

    resumeTask: () => withAction('resume', async () => {
      const id = get().selectedId
      if (!id) return
      await api.resumeCoworkTask(id)
      await get().refreshDetail()
      await get().fetchTasks()
      await connect(id)
    }),

    cancelTask: () => withAction('cancel', async () => {
      const id = get().selectedId
      if (!id) return
      await api.cancelCoworkTask(id)
      await get().refreshDetail()
      await get().fetchTasks()
    }),

    acceptTask: () => withAction('accept', async () => {
      const id = get().selectedId
      if (!id) return
      await api.acceptCoworkTask(id)
      await get().refreshDetail()
      await get().fetchTasks()
    }),

    reviseTask: (input) => withAction('revise', async () => {
      const id = get().selectedId
      if (!id) return
      const result = await api.reviseCoworkTask(id, input)
      await get().fetchTasks()
      await get().refreshDetail()
      if (result.run_id) await connect(id)
    }),

    decideApproval: (approvalId, action, options) =>
      withAction(`approval:${approvalId}`, async () => {
        const detail = await api.decideCoworkApproval(approvalId, {
          action,
          ...(options?.reason ? { reason: options.reason } : {}),
          ...(options?.modified_plan ? { modified_plan: options.modified_plan } : {}),
        })
        if (get().selectedId === detail.task.id) set({ detail })
        await get().fetchTasks()
        await get().fetchApprovals()
        if (get().selectedId === detail.task.id) await get().fetchFileBackups()
      }),

    connect,

    disconnect: () => {
      streamedTaskId = null
      stopStream()
      set({ connection: 'idle' })
    },
  }
})
