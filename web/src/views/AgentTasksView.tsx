import { useEffect, useState, type ReactNode } from 'react'
import { RefreshCw, Info, AlertTriangle, Cpu, Check, X, Clock, Layers, List } from 'lucide-react'
import { api } from '@/api'
import { useSessionStore } from '@/stores/session'
import { buildAgentDependencies } from '@/utils/agentDependencies'
import { toErrorMessage } from '@/utils/error'
import { cn } from '@/lib/utils'
import type { DeferredRun, DeferredRunStatus } from '@/types'

const POLL_INTERVAL_MS = 4_000

interface AgentTask {
  run_id: string
  status: DeferredRunStatus
  parent_turn_id: string | null
  /** 毫秒时间戳。 */
  created_at: number
  updated_at: number
  duration: number
  attempts: number
  result: string | null
  cancel_reason: DeferredRun['cancel_reason']
  error_code?: string
  error_message?: string
  cancellable: boolean
}

interface ViewTimelineEvent {
  id: string
  type: string
  status: DeferredRunStatus
  title: string
  description: string
  timestamp: number
  duration?: number
  metadata: Record<string, string | number>
  actions: { label: string; type: string }[]
}

const STATUS_TEXT: Record<string, string> = {
  queued: '等待执行',
  running: '执行中',
  succeeded: '已完成',
  failed: '未完成',
  cancelled: '已取消',
}

const ERROR_TEXT: Record<string, string> = {
  timeout: '执行超时',
  deferred_run_failed: '子任务执行失败',
}

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  queued: 1,
  succeeded: 2,
  failed: 3,
  cancelled: 4,
}

function isUnavailableError(e: unknown): boolean {
  return e instanceof Error && /\b404\b/.test(e.message)
}

function toMillis(seconds: unknown): number {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 1e11 ? n : n * 1000
}

function toTask(run: DeferredRun): AgentTask {
  const created = toMillis(run.created_at)
  const updated = toMillis(run.updated_at)
  const active = run.status === 'queued' || run.status === 'running'
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
    cancellable: active,
  }
}

/** 失败原因：优先用后端透传的 message，其次把错误码翻成人话。 */
function failureText(task: { error_code?: string; error_message?: string }): string | undefined {
  if (task.error_message) return task.error_message
  if (!task.error_code) return undefined
  return ERROR_TEXT[task.error_code] ?? `执行失败（${task.error_code}）`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function relativeTime(timestamp: number, now: number): string {
  const diff = now - timestamp
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return new Date(timestamp).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function StatePanel({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="max-w-xl mx-auto py-14 px-6 flex flex-col items-center gap-3 text-center bg-card border border-border rounded-lg">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      {children}
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn('font-mono tabular-nums text-lg font-semibold', color ?? 'text-foreground')}>{value}</span>
    </div>
  )
}

function AgentCard({ task, onCancel, onExpand, cancelling }: {
  task: AgentTask
  onCancel: () => void
  onExpand: () => void
  cancelling: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="p-3.5 border border-border rounded-lg bg-secondary">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">子任务 {task.run_id.slice(0, 8)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{STATUS_TEXT[task.status] ?? task.status}</div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => { if (!expanded) onExpand(); setExpanded(v => !v) }}
            className="px-2.5 py-1 border border-border rounded-md bg-card text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            {expanded ? '收起' : '详情'}
          </button>
          {task.cancellable && (
            <button
              disabled={cancelling}
              onClick={onCancel}
              className="px-2.5 py-1 border border-border rounded-md bg-card text-xs text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {cancelling ? '取消中…' : '取消'}
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-muted-foreground">
        <span>尝试 {task.attempts} 次</span>
        {task.duration ? <span className="inline-flex items-center gap-1"><Clock className="size-3" />{formatDuration(task.duration)}</span> : null}
      </div>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-border text-xs text-muted-foreground">
          {task.result ? <p className="whitespace-pre-wrap break-words m-0">{task.result}</p>
            : failureText(task) ? <p className="text-destructive m-0">{failureText(task)}</p>
            : task.cancel_reason ? <p className="m-0">已取消：{task.cancel_reason}</p>
            : <p className="m-0">暂无结果全文，展开时尝试加载…</p>}
        </div>
      )}
    </div>
  )
}

function TimelinePanel({ events, isLive, onAction }: {
  events: ViewTimelineEvent[]
  isLive: boolean
  onAction: (eventId: string, actionType: string) => void
}) {
  const [filter, setFilter] = useState<'all' | 'running' | 'completed'>('all')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  let filtered = events
  if (filter === 'running') filtered = events.filter(e => e.status === 'running' || e.status === 'queued')
  else if (filter === 'completed') filtered = events.filter(e => e.status === 'succeeded' || e.status === 'failed' || e.status === 'cancelled')
  const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp)
  const hasRunning = events.some(e => e.status === 'running')

  return (
    <div className="flex flex-col w-full max-w-[800px] bg-card border border-border rounded-lg overflow-hidden mt-8 mx-auto">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border flex-wrap">
        <h3 className="text-base font-semibold text-foreground m-0">执行时间线</h3>
        <div className="flex gap-1.5" role="group" aria-label="时间线过滤">
          {(['all', 'running', 'completed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn('px-3 py-1.5 border rounded-md text-xs font-medium transition-colors', filter === f ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-secondary')}
            >
              {f === 'all' ? '全部' : f === 'running' ? '进行中' : '已完成'}
            </button>
          ))}
        </div>
      </div>
      <div className="relative p-5 max-h-[600px] overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <List className="size-4" />
            <p className="text-sm m-0">{filter === 'running' ? '当前没有正在执行的任务' : filter === 'completed' ? '还没有完成的任务' : '时间线为空'}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map(event => (
              <div key={event.id} className="flex gap-3">
                <div className="shrink-0 pt-0.5">
                  <span className={cn('size-6 rounded-full inline-flex items-center justify-center border', event.status === 'succeeded' ? 'border-success text-success' : event.status === 'failed' ? 'border-destructive text-destructive' : 'border-muted-foreground text-muted-foreground')}>
                    {event.status === 'succeeded' ? <Check className="size-3" />
                      : event.status === 'failed' ? <X className="size-3" />
                      : event.status === 'running' ? <span className="text-xs">◉</span>
                      : <span className="text-xs">○</span>}
                  </span>
                </div>
                <div className="flex-1 min-w-0 p-2.5 border border-border rounded-lg bg-secondary">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{event.title}</span>
                    <span className="text-xs text-muted-foreground">{relativeTime(event.timestamp, now)}</span>
                  </div>
                  {event.description && <p className="text-xs text-muted-foreground mt-1 mb-0">{event.description}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {Object.entries(event.metadata).map(([k, v]) => (
                      <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-card text-muted-foreground"><strong className="text-foreground">{k}:</strong> {v}</span>
                    ))}
                  </div>
                  {event.actions.length > 0 && (
                    <div className="flex gap-1.5 mt-2">
                      {event.actions.map(action => (
                        <button key={action.label} onClick={() => onAction(event.id, action.type)} className="px-2 py-1 border border-border rounded-md bg-card text-xs text-muted-foreground hover:bg-muted transition-colors">{action.label}</button>
                      ))}
                    </div>
                  )}
                  {event.duration ? (
                    <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground"><Clock className="size-3" />{formatDuration(event.duration)}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        {isLive && hasRunning && (
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-success animate-pulse" />实时更新中
          </div>
        )}
      </div>
    </div>
  )
}

export default function AgentTasksView() {
  const sessionId = useSessionStore(s => s.sessionId)
  const [refreshKey, setRefreshKey] = useState(0)
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [cancelling, setCancelling] = useState<Set<string>>(() => new Set())
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null

    function schedule() {
      if (disposed || timer) return
      timer = setTimeout(() => { timer = null; void poll() }, POLL_INTERVAL_MS)
    }

    async function poll() {
      if (disposed) return
      if (!sessionId) { setTasks([]); return }
      setLoading(true)
      try {
        const data = await api.listDeferredRuns(sessionId)
        if (disposed) return
        const mapped = (data?.runs ?? []).map(toTask)
        setTasks(prev => {
          const loaded = new Map(prev.filter(t => t.result != null).map(t => [t.run_id, t.result!] as const))
          return mapped.map(t => {
            if (t.result == null) {
              const cached = loaded.get(t.run_id)
              if (cached != null) return { ...t, result: cached }
            }
            return t
          })
        })
        setHasMore(Boolean(data?.has_more))
        setError(null)
        setUnavailable(false)
        if (mapped.some(t => t.cancellable)) schedule()
      } catch (e) {
        if (disposed) return
        if (isUnavailableError(e)) { setUnavailable(true); setTasks([]) }
        else setError(toErrorMessage(e))
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    setUnavailable(false)
    setError(null)
    void poll()

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, refreshKey])

  async function loadRunResult(runId: string) {
    if (!sessionId) return
    try {
      const run = await api.getDeferredRun(sessionId, runId)
      const detail = toTask(run)
      setTasks(prev => prev.map(t => t.run_id === runId ? {
        ...t,
        result: detail.result ?? t.result,
        error_code: detail.error_code ?? t.error_code,
        error_message: detail.error_message ?? t.error_message,
        updated_at: Math.max(t.updated_at, detail.updated_at),
      } : t))
      setUnavailable(false)
    } catch (e) {
      if (isUnavailableError(e)) setUnavailable(true)
    }
  }

  async function cancel(runId: string) {
    if (!sessionId || cancelling.has(runId)) return
    setCancelling(prev => new Set(prev).add(runId))
    try {
      const updated = await api.cancelDeferredRun(sessionId, runId)
      const next = toTask(updated)
      setTasks(prev => prev.map(t => t.run_id === runId ? next : t))
      setError(null)
    } catch (e) {
      if (isUnavailableError(e)) setUnavailable(true)
      else setError(toErrorMessage(e))
    } finally {
      setCancelling(prev => { const next = new Set(prev); next.delete(runId); return next })
      setRefreshKey(k => k + 1)
    }
  }

  async function cancelAll() {
    const pending = tasks.filter(t => t.cancellable).map(t => t.run_id)
    for (const runId of pending) await cancel(runId)
  }

  function handleExpandAgent(agentId: string) {
    const task = tasks.find(t => t.run_id === agentId)
    if (task?.result != null) return
    void loadRunResult(agentId)
  }

  function handleTimelineAction(eventId: string, actionType: string) {
    if (actionType === 'cancel') void cancel(eventId)
  }

  const counts = {
    running: tasks.filter(t => t.status === 'running').length,
    queued: tasks.filter(t => t.status === 'queued').length,
    succeeded: tasks.filter(t => t.status === 'succeeded').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  }
  const hasActive = tasks.some(t => t.cancellable)
  const totalDuration = tasks.reduce((sum, t) => sum + (t.duration || 0), 0)
  const sortedTasks = [...tasks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
  const agentDependencies = buildAgentDependencies(tasks)

  const timelineEvents: ViewTimelineEvent[] = tasks.map(task => {
    const eventType = task.status === 'succeeded' ? 'complete'
      : task.status === 'failed' ? 'error'
      : task.status === 'running' ? 'progress'
      : 'info'
    const actions: { label: string; type: string }[] = []
    if (task.cancellable) actions.push({ label: '取消', type: 'cancel' })
    return {
      id: task.run_id,
      type: eventType,
      status: task.status,
      title: `子任务 ${task.run_id.slice(0, 8)}`,
      description: STATUS_TEXT[task.status] ?? task.status,
      timestamp: task.updated_at || task.created_at,
      duration: task.duration,
      metadata: {
        状态: STATUS_TEXT[task.status] ?? task.status,
        尝试次数: task.attempts,
        ...(task.error_code ? { 错误码: task.error_code } : {}),
      },
      actions,
    }
  })

  return (
    <div className="min-h-full">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Agent 任务中心</h1>
          <p className="text-sm text-muted-foreground mt-1">当前会话的后台子任务。数据来自后端 deferred-runs 接口，不是演示数据。</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={loading && tasks.length === 0}
            onClick={() => setRefreshKey(k => k + 1)}
            aria-label="刷新任务列表"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-border rounded-lg bg-card text-muted-foreground text-[13px] hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw className="size-4" />
            <span>{loading && tasks.length === 0 ? '加载中' : '刷新'}</span>
          </button>
        </div>
      </header>

      {unavailable ? (
        <StatePanel icon={<Info className="size-6" />}>
          <h2 className="text-xl font-semibold text-foreground m-0">后台子任务功能未启用</h2>
          <p className="text-sm text-muted-foreground m-0">当前后端未开放 deferred-runs 能力，因此这里没有可展示的任务。</p>
        </StatePanel>
      ) : loading && tasks.length === 0 ? (
        <StatePanel>
          <span className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground m-0">正在读取后台任务…</p>
        </StatePanel>
      ) : error && tasks.length === 0 ? (
        <StatePanel icon={<AlertTriangle className="size-6" />}>
          <h2 className="text-xl font-semibold text-destructive m-0">读取任务失败</h2>
          <p className="text-sm text-muted-foreground m-0">{error}</p>
          <button onClick={() => setRefreshKey(k => k + 1)} className="px-3.5 py-2 border border-border rounded-lg bg-card text-muted-foreground text-[13px] hover:bg-secondary transition-colors">重试</button>
        </StatePanel>
      ) : tasks.length === 0 ? (
        <StatePanel icon={<Cpu className="size-6" />}>
          <h2 className="text-xl font-semibold text-foreground m-0">暂无后台子任务</h2>
          <p className="text-sm text-muted-foreground m-0">当你在对话中派发子 Agent 时，任务会出现在这里。</p>
        </StatePanel>
      ) : (
        <>
          <section className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border flex-wrap">
              <div className="flex items-center gap-2">
                <Layers className="size-5 text-muted-foreground" />
                <h2 className="text-base font-semibold text-foreground m-0">Agent 编排中心</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{tasks.length} 个任务</span>
              </div>
              {hasActive && (
                <button onClick={() => void cancelAll()} className="px-3 py-1.5 border border-border rounded-lg bg-secondary text-xs text-muted-foreground hover:bg-muted transition-colors">取消全部</button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-5 py-4 border-b border-border">
              <MiniStat label="运行中" value={counts.running} color="text-link" />
              <MiniStat label="等待中" value={counts.queued} color="text-status-interrupted" />
              <MiniStat label="已完成" value={counts.succeeded} color="text-success" />
              <MiniStat label="失败" value={counts.failed} color="text-destructive" />
              <MiniStat label="累计耗时" value={formatDuration(totalDuration)} />
            </div>
            <div className="px-5 py-2 border-b border-border text-[11px] text-muted-foreground">依赖边 {agentDependencies.length} 条（同一回合内并行、跨回合顺序）</div>
            <div className="flex flex-col gap-2 p-4">
              {sortedTasks.map(task => (
                <AgentCard
                  key={task.run_id}
                  task={task}
                  cancelling={cancelling.has(task.run_id)}
                  onCancel={() => void cancel(task.run_id)}
                  onExpand={() => handleExpandAgent(task.run_id)}
                />
              ))}
            </div>
          </section>

          {hasMore && <p className="max-w-[1200px] mx-auto mt-3 text-xs text-muted-foreground text-right">仅显示最近一批已结束任务；更早的记录仍保留在后台。</p>}

          <div className="max-w-[1200px] mx-auto">
            <TimelinePanel events={timelineEvents} isLive={hasActive} onAction={handleTimelineAction} />
          </div>
        </>
      )}
    </div>
  )
}
