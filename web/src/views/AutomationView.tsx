import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api'
import { toErrorMessage } from '@/utils/error'
import { cn } from '@/lib/utils'

interface AutomationAction {
  type: string
  payload: Record<string, unknown>
}

interface Automation {
  id: string
  name: string
  description: string
  cron_expr: string | null
  interval_seconds: number | null
  action: AutomationAction
  enabled: boolean
  created_at: string
  last_run: string | null
  next_run: string | null
  run_count: number
}

interface RunHistoryEntry {
  id: number
  automation_id: string
  started_at: string
  finished_at: string
  status: string
  result: string | null
}

/** 简单 5 字段 cron 校验（分 时 日 月 周；* 数字 , - /）——与后端解析规则一致。 */
function computeScheduleError(raw: string): string {
  const expr = raw.trim()
  if (!expr) return ''
  const fields = expr.split(/\s+/)
  if (fields.length !== 5) return 'Cron 需要 5 个字段（分 时 日 月 周），如 0 9 * * 1-5'
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]
  for (let i = 0; i < 5; i++) {
    const part = fields[i]
    if (!/^(\*|[0-9,-/]+|[a-zA-Z]+)(\/\d+)?$/.test(part)) return `第 ${i + 1} 个字段无效：${part}`
    const [lo, hi] = ranges[i]
    for (const seg of part.split(',')) {
      const base = seg.split('/')[0]
      if (base === '*' || /^[a-zA-Z]+$/.test(base)) continue
      const nums = base.split('-').map(Number)
      if (nums.some(n => !Number.isFinite(n) || n < lo || n > hi)) return `第 ${i + 1} 个字段超出范围 ${lo}-${hi}：${part}`
      if (nums.length === 2 && nums[0] > nums[1]) return `第 ${i + 1} 个字段范围颠倒：${part}`
    }
  }
  return ''
}

/** 后端 action 为结构化对象，展示其自由文本或类型。 */
function actionLabel(a: Automation): string {
  const text = a.action?.payload?.text
  if (typeof text === 'string' && text.trim()) return text
  return a.action?.type ?? '—'
}

/** 展示调度：优先 cron 表达式，否则按秒间隔。 */
function scheduleLabel(a: Automation): string {
  if (a.cron_expr) return a.cron_expr
  if (a.interval_seconds) return `每 ${a.interval_seconds} 秒`
  return '—'
}

export default function AutomationView() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [automations, setAutomations] = useState<Automation[]>([])
  const [form, setForm] = useState({ name: '', schedule: '', action: '' })
  const [running, setRunning] = useState<Set<string>>(() => new Set())
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null)
  const [historyMap, setHistoryMap] = useState<Record<string, RunHistoryEntry[]>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState('')

  const canCreate = Boolean(form.name.trim() && form.schedule.trim() && form.action.trim() && !scheduleError)

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await api.request<{ automations: Automation[] }>('/automations')
      setAutomations(res.automations)
    } catch (e) {
      setError(toErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setForm({ name: '', schedule: '', action: '' })
    setEditingId(null)
    setScheduleError('')
  }

  function startEdit(a: Automation) {
    const schedule = a.cron_expr ?? (a.interval_seconds ? `*/${Math.max(1, Math.round(a.interval_seconds / 60))} * * * *` : '')
    setForm({ name: a.name, schedule, action: actionLabel(a) })
    setEditingId(a.id)
    setScheduleError(computeScheduleError(schedule))
  }

  async function handleCreate() {
    if (!canCreate) return
    try {
      const payload = {
        name: form.name.trim(),
        cron_expr: form.schedule.trim(),
        action: { type: 'custom', payload: { text: form.action.trim() } },
      }
      if (editingId) {
        const updated = await api.request<Automation>(`/automations/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        setAutomations(prev => prev.map(x => x.id === editingId ? updated : x))
        toast.success('自动化任务已更新')
      } else {
        const created = await api.request<Automation>('/automations', { method: 'POST', body: JSON.stringify(payload) })
        setAutomations(prev => [...prev, created])
        toast.success('自动化任务已创建')
      }
      resetForm()
    } catch (e) {
      setError(toErrorMessage(e))
      toast.error(`保存失败: ${toErrorMessage(e)}`)
    }
  }

  async function handleToggle(a: Automation) {
    try {
      const updated = await api.request<Automation>(`/automations/${a.id}/toggle`, { method: 'PATCH' })
      setAutomations(prev => prev.map(x => x.id === a.id ? updated : x))
    } catch (e) {
      setError(toErrorMessage(e))
    }
  }

  async function handleRun(a: Automation) {
    if (running.has(a.id)) return
    setRunning(prev => new Set(prev).add(a.id))
    try {
      await api.request(`/automations/${a.id}/run`, { method: 'POST' })
      await load()
      if (expandedHistory === a.id) await loadHistory(a.id)
    } catch (e) {
      setError(toErrorMessage(e))
    } finally {
      setRunning(prev => { const next = new Set(prev); next.delete(a.id); return next })
    }
  }

  async function loadHistory(id: string) {
    try {
      const res = await api.request<{ history: RunHistoryEntry[] }>(`/automations/${id}/history`)
      setHistoryMap(prev => ({ ...prev, [id]: res.history }))
    } catch (e) {
      setError(toErrorMessage(e))
    }
  }

  async function toggleHistory(a: Automation) {
    if (expandedHistory === a.id) { setExpandedHistory(null); return }
    setExpandedHistory(a.id)
    if (!historyMap[a.id]) await loadHistory(a.id)
  }

  async function handleDelete(id: string) {
    if (!window.confirm('确定要删除此自动化任务吗？')) return
    try {
      await api.request(`/automations/${id}`, { method: 'DELETE' })
      setAutomations(prev => prev.filter(a => a.id !== id))
    } catch (e) {
      setError(toErrorMessage(e))
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-foreground">自动化</h2>
        <p className="text-sm text-muted-foreground mt-1">定时任务与自动化调度</p>
      </div>

      <div className="mb-4 p-4 bg-card border border-border rounded-lg">
        <div className="flex flex-wrap gap-2">
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            type="text"
            placeholder="任务名称"
            className="flex-1 min-w-[120px] px-3 py-2 border border-border rounded-lg bg-secondary text-foreground text-sm outline-none focus:border-ring"
          />
          <input
            value={form.schedule}
            onChange={e => { const v = e.target.value; setForm(f => ({ ...f, schedule: v })); setScheduleError(computeScheduleError(v)) }}
            type="text"
            placeholder="Cron 表达式 (如 0 9 * * *)"
            className={cn('flex-1 min-w-[120px] px-3 py-2 border border-border rounded-lg bg-secondary text-foreground text-sm outline-none focus:border-ring', scheduleError && 'border-destructive')}
          />
          {scheduleError ? (
            <p className="w-full text-destructive text-xs mt-0.5 mb-0">{scheduleError}</p>
          ) : (
            <p className="w-full text-muted-foreground text-xs mt-0.5 mb-0">5 字段 Cron：分 时 日 月 周（如 <code className="font-mono">0 9 * * 1-5</code> = 工作日 9:00）。调度器约每分钟检查一次。</p>
          )}
          <input
            value={form.action}
            onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
            type="text"
            placeholder="执行动作"
            className="flex-1 min-w-[120px] px-3 py-2 border border-border rounded-lg bg-secondary text-foreground text-sm outline-none focus:border-ring"
          />
          <button
            disabled={!canCreate}
            onClick={() => void handleCreate()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {editingId ? '保存修改' : '创建'}
          </button>
          {editingId && (
            <button onClick={resetForm} className="px-4 py-2 rounded-lg border border-border bg-secondary text-muted-foreground text-sm whitespace-nowrap">取消编辑</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">加载中...</div>
      ) : error ? (
        <div className="px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      ) : automations.length === 0 ? (
        <div className="flex flex-col items-center text-center py-10">
          <Clock className="size-6 text-muted-foreground mb-3" />
          <h3 className="font-semibold text-foreground mb-1">暂无自动化任务</h3>
          <p className="text-sm text-muted-foreground">创建定时任务来自动执行重复性工作。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {automations.map(a => (
            <div key={a.id} className={cn('p-4 bg-card border border-border rounded-lg', !a.enabled && 'opacity-60')}>
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <span className="font-semibold text-sm text-foreground">{a.name}</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    disabled={running.has(a.id)}
                    onClick={() => void handleRun(a)}
                    className="px-3 py-1 border border-border rounded-md bg-secondary text-muted-foreground text-xs hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {running.has(a.id) ? '运行中…' : '立即运行'}
                  </button>
                  <button onClick={() => void toggleHistory(a)} className="px-3 py-1 border border-border rounded-md bg-secondary text-muted-foreground text-xs hover:bg-muted transition-colors">历史</button>
                  <button onClick={() => void handleToggle(a)} className="px-3 py-1 border border-border rounded-md bg-secondary text-muted-foreground text-xs hover:bg-muted transition-colors">{a.enabled ? '暂停' : '启用'}</button>
                  <button onClick={() => startEdit(a)} className="px-3 py-1 border border-border rounded-md bg-secondary text-muted-foreground text-xs hover:bg-muted transition-colors">编辑</button>
                  <button onClick={() => void handleDelete(a.id)} className="px-3 py-1 border border-destructive/30 rounded-md bg-destructive/5 text-destructive text-xs hover:bg-destructive/10 transition-colors">删除</button>
                </div>
              </div>
              <div className="flex gap-4 flex-wrap">
                <span className="text-xs text-muted-foreground">📅 {scheduleLabel(a)}</span>
                <span className="text-xs text-muted-foreground">⚡ {actionLabel(a)}</span>
                {a.run_count ? <span className="text-xs text-muted-foreground">已执行 {a.run_count} 次</span> : null}
              </div>
              {expandedHistory === a.id && (
                <div className="mt-3 pt-3 border-t border-border">
                  {!historyMap[a.id] ? (
                    <div className="text-xs text-muted-foreground py-1">加载中...</div>
                  ) : historyMap[a.id].length === 0 ? (
                    <div className="text-xs text-muted-foreground py-1">暂无执行记录</div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {historyMap[a.id].map(run => (
                        <div key={run.id} className="flex gap-3 items-center text-xs">
                          <span className={cn('px-2 py-0.5 rounded text-[11px] uppercase bg-secondary text-muted-foreground', run.status === 'completed' && 'bg-success/10 text-success', run.status === 'failed' && 'bg-destructive/10 text-destructive')}>{run.status}</span>
                          <span className="text-muted-foreground">{run.started_at}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
