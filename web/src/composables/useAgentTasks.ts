/**
 * useAgentTasks — 后台子任务（deferred runs）的真实数据源。
 *
 * ## 为什么不用 mock
 *
 * 后端 `bun-backend/src/routes/deferred-runs.ts` 已经提供三个端点：
 *   GET  /api/sessions/:sessionId/deferred-runs           列出本会话全部任务
 *   GET  /api/sessions/:sessionId/deferred-runs/:runId    单个任务
 *   POST /api/sessions/:sessionId/deferred-runs/:runId/cancel  取消任务
 *
 * 任务中心直接读这份数据，不再自造演示数据。
 *
 * ## 隐私边界
 *
 * 只消费 `DeferredRun`（浏览器安全投影）里的字段。ADR 0003 规定：完整 prompt、
 * 子会话记录、凭据与原始工具结果**不得**进入父级摘要。后端记录里虽含
 * `task` / `name`，但前端的 `DeferredRun` 类型刻意不暴露它们——这里同样不读，
 * 标题一律用不透明的 run_id 短串。`useChat.ts` 的既有约定
 * （"Deferred mode deliberately sends only an opaque ID"）与此一致。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { api } from '@/api'
import type { DeferredRun, DeferredRunStatus } from '@/types'
import { createLogger } from '@/utils/logger'

const log = createLogger('useAgentTasks')

/** 有活跃任务时的轮询间隔。 */
const POLL_INTERVAL_MS = 4_000

export type AgentTaskStatus = DeferredRunStatus

export interface AgentTask {
  run_id: string
  status: AgentTaskStatus
  /** 父轮次 id。同一个 parent_turn_id 下的任务互为并行兄弟。 */
  parent_turn_id: string | null
  /** 后端时间戳是**秒**（`Math.floor(Date.now() / 1000)`），此处统一成毫秒。 */
  created_at: number
  updated_at: number
  /** 运行耗时（毫秒）。updated_at 早于 created_at 时视为 0。 */
  duration: number
  attempts: number
  result: string | null
  cancel_reason: DeferredRun['cancel_reason']
  error_code?: string
  error_message?: string
  /** 是否可取消（排队中 / 执行中）。 */
  cancellable: boolean
  /** 终态任务。 */
  settled: boolean
}

export interface UseAgentTasksOptions {
  /** 要观察的会话 id。为空时不加载。 */
  sessionId: () => string
  /** 关闭轮询（仅测试用）。 */
  autoRefresh?: boolean
}

function toMillis(seconds: unknown): number {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return 0
  // 后端存的是秒；若某天改成毫秒，这里也能自适应（> 1e11 视为已是毫秒）。
  return n > 1e11 ? n : n * 1000
}

function isActive(status: DeferredRunStatus): boolean {
  return status === 'queued' || status === 'running'
}

/** 把后端的浏览器安全投影映射成本模块的任务模型。 */
function toTask(run: DeferredRun): AgentTask {
  const created = toMillis(run.created_at)
  const updated = toMillis(run.updated_at)
  return {
    run_id: run.run_id,
    status: run.status,
    parent_turn_id: run.parent_turn_id ?? null,
    created_at: created,
    updated_at: updated,
    duration: updated > created ? updated - created : 0,
    attempts: Number(run.attempts ?? 0),
    result: run.result ?? null,
    cancel_reason: run.cancel_reason ?? null,
    error_code: run.error_code ?? undefined,
    error_message: run.error_message ?? undefined,
    cancellable: isActive(run.status),
    settled: !isActive(run.status),
  }
}

export function useAgentTasks(options: UseAgentTasksOptions) {
  const tasks = ref<AgentTask[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** 后端能力不可用（功能关闭 / 端点 404）。此时整个面板应当隐藏。 */
  const unavailable = ref(false)
  const cancelling = ref<Set<string>>(new Set())
  /** 列表是否还有更早的终态任务被裁剪。 */
  const hasMore = ref(false)

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  /** 当前在途请求所属的会话。用于区分「同会话重复请求」与「切换会话」。 */
  let inFlightSession: string | null = null

  const activeCount = computed(() => tasks.value.filter(t => t.cancellable).length)
  const hasActive = computed(() => activeCount.value > 0)

  function isUnavailableError(error: unknown): boolean {
    return error instanceof Error && /\b404\b/.test(error.message)
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  function schedulePolling() {
    stopPolling()
    if (disposed) return
    if (options.autoRefresh === false) return
    if (!hasActive.value) return
    pollTimer = setTimeout(() => {
      void refresh()
    }, POLL_INTERVAL_MS)
  }

  async function refresh(): Promise<void> {
    const sessionId = options.sessionId()
    // `loading` 只用来防止**同一会话**的重复请求。会话已经变了就必须放行，
    // 否则切换会话时新会话的请求会被旧会话的在途请求挡掉，列表永远不更新。
    if (disposed || (loading.value && inFlightSession === sessionId)) return
    if (!sessionId) {
      tasks.value = []
      return
    }

    // 记住本次请求对应的会话：await 期间用户可能已经切换会话。
    // 若不校验，旧会话的响应会覆盖新会话的任务列表（竞态）。
    const requestedSession = sessionId
    inFlightSession = requestedSession
    loading.value = true
    try {
      const data = await api.listDeferredRuns(requestedSession)
      // 会话已切换 → 丢弃这次响应，不要污染新会话的状态。
      if (options.sessionId() !== requestedSession) return
      // 列表不返回 result 全文。用户展开卡片时已经懒加载过的 result
      // 不能被下一轮轮询覆盖回 null（详情请求与轮询可能并发）。
      const loadedResults = new Map(
        tasks.value.filter(t => t.result != null).map(t => [t.run_id, t.result!] as const),
      )
      tasks.value = (data?.runs ?? []).map((run) => {
        const task = toTask(run)
        const cached = loadedResults.get(task.run_id)
        if (task.result == null && cached != null) task.result = cached
        return task
      })
      hasMore.value = Boolean(data?.has_more)
      error.value = null
      // 后端恢复后允许重新显示：不能因为一次 404 就永久隐藏面板。
      unavailable.value = false
    } catch (e) {
      if (options.sessionId() !== requestedSession) return
      if (isUnavailableError(e)) {
        // 能力关闭：没有 UI 面，隐藏整个面板而不是报错。
        unavailable.value = true
        tasks.value = []
        stopPolling()
        return
      }
      log.warn('加载后台子任务失败:', e)
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      // 只有当在途的仍是自己时才清 loading——否则旧请求的 finally 会把
      // 新请求的 loading 提前清掉，UI 提前显示「已加载」。
      if (inFlightSession === requestedSession) {
        inFlightSession = null
        loading.value = false
        schedulePolling()
      }
    }
  }

  /**
   * 懒加载单条任务详情（主要是 `result` 全文）。
   *
   * 列表接口为了控制轮询体积不返回 result；卡片展开时再补一次单条请求，
   * 失败就保持列表里的字段，不影响主流程。
   */
  async function loadRunResult(runId: string): Promise<void> {
    const sessionId = options.sessionId()
    if (!sessionId) return
    try {
      const run = await api.getDeferredRun(sessionId, runId)
      if (options.sessionId() !== sessionId) return
      const detail = toTask(run)
      // 只补详情字段：轮询可能在详情请求之后带回更新的状态，
      // 不能用较旧的详情把状态/时间戳整体覆盖回去。
      tasks.value = tasks.value.map((t) =>
        t.run_id === runId
          ? {
              ...t,
              result: detail.result ?? t.result,
              error_code: detail.error_code ?? t.error_code,
              error_message: detail.error_message ?? t.error_message,
              updated_at: Math.max(t.updated_at, detail.updated_at),
            }
          : t,
      )
      unavailable.value = false
    } catch (e) {
      if (isUnavailableError(e)) {
        unavailable.value = true
      } else {
        log.warn('加载子任务详情失败:', e)
      }
    }
  }

  async function cancel(runId: string): Promise<void> {
    const sessionId = options.sessionId()
    if (!sessionId || cancelling.value.has(runId)) return

    cancelling.value = new Set(cancelling.value).add(runId)
    try {
      const updated = await api.cancelDeferredRun(sessionId, runId)
      const next = toTask(updated)
      tasks.value = tasks.value.map(t => (t.run_id === runId ? next : t))
      error.value = null
    } catch (e) {
      if (isUnavailableError(e)) {
        unavailable.value = true
      } else {
        log.warn('取消后台子任务失败:', e)
        error.value = e instanceof Error ? e.message : String(e)
      }
    } finally {
      const next = new Set(cancelling.value)
      next.delete(runId)
      cancelling.value = next
      schedulePolling()
    }
  }

  /** 取消全部仍在执行的任务。逐个调用取消端点，失败的条目保留原状。 */
  async function cancelAll(): Promise<void> {
    const pending = tasks.value.filter(t => t.cancellable).map(t => t.run_id)
    for (const runId of pending) {
      await cancel(runId)
    }
  }

  watch(
    () => options.sessionId(),
    () => {
      unavailable.value = false
      error.value = null
      void refresh()
    },
    // immediate：组件挂载时立即拉一次。缺这一项的话，首次加载要等
    // sessionId 发生变化才触发——页面会一直停在「空状态」。
    { immediate: true },
  )

  onUnmounted(() => {
    disposed = true
    stopPolling()
  })

  return {
    tasks,
    loading,
    error,
    unavailable,
    cancelling,
    activeCount,
    hasActive,
    hasMore,
    refresh,
    loadRunResult,
    cancel,
    cancelAll,
  }
}
