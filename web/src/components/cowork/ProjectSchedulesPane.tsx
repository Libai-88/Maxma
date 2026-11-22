import { useEffect, useState } from 'react'
import { CalendarClock, Loader2, Trash2 } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { StatusPill } from '@/components/cowork/taskUi'
import type { CoworkSchedule, CoworkTask } from '@/types/cowork'

export function ProjectSchedulesPane({ projectId, tasks, onNotice }: {
  projectId: string
  tasks: CoworkTask[]
  onNotice: (message: string) => void
}) {
  const [schedules, setSchedules] = useState<CoworkSchedule[]>([])
  const [presets, setPresets] = useState<Array<{ id: string; label: string; cron: string }>>([])
  const [note, setNote] = useState('')
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [taskId, setTaskId] = useState('')
  const [cron, setCron] = useState('0 9 * * 1')
  const [timezone, setTimezone] = useState('Asia/Shanghai')
  const [missed, setMissed] = useState('skip')

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const data = await api.listCoworkSchedules(projectId)
      setSchedules(data.schedules)
      setPresets(data.presets)
      setNote(data.note)
      setRunning(data.running)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setSchedules([])
    setTaskId('')
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!taskId && tasks.length > 0) setTaskId(tasks[0].id)
  }, [taskId, tasks])

  async function create(): Promise<void> {
    if (!taskId || !cron.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await api.createCoworkSchedule({ task_id: taskId, cron: cron.trim(), timezone, missed_policy: missed })
      onNotice('定时任务已创建。')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(schedule: CoworkSchedule): Promise<void> {
    try {
      await api.updateCoworkSchedule(schedule.id, { enabled: schedule.enabled !== 1 })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(schedule: CoworkSchedule): Promise<void> {
    try {
      await api.deleteCoworkSchedule(schedule.id)
      onNotice('定时任务已删除。')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">定时任务</h2>
          <p className="text-caption text-muted-foreground">只在 Maxma 应用运行时执行；关闭应用不会运行。</p>
        </div>
        <span className={cn(
          'rounded-full border px-2.5 py-1 text-caption',
          running ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-panel text-muted-foreground',
        )}>
          {running ? '调度器运行中' : '调度器未启动'}
        </span>
      </div>

      {note && <p className="rounded-md border border-border bg-panel px-3 py-2 text-caption text-muted-foreground">{note}</p>}

      <div className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_1fr_1fr_auto]">
        <select
          value={taskId}
          onChange={(event) => setTaskId(event.target.value)}
          aria-label="定时触发的任务"
          className="h-9 min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        >
          {tasks.length === 0 ? <option value="">先建任务</option> : tasks.map((task) => (
            <option key={task.id} value={task.id}>{task.title}</option>
          ))}
        </select>
        <select
          value={cron}
          onChange={(event) => setCron(event.target.value)}
          aria-label="触发频率"
          className="h-9 min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        >
          {presets.map((preset) => <option key={preset.id} value={preset.cron}>{preset.label}</option>)}
          {!presets.some((preset) => preset.cron === cron) && <option value={cron}>{cron}</option>}
        </select>
        <Input value={cron} onChange={(event) => setCron(event.target.value)} aria-label="cron 表达式" className="h-9 font-mono text-xs" />
        <select
          value={missed}
          onChange={(event) => setMissed(event.target.value)}
          aria-label="错过策略"
          className="h-9 min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        >
          <option value="skip">超过 24h 跳过</option>
          <option value="run_once">重启补跑一次</option>
        </select>
        <Button size="sm" disabled={busy || !taskId || !cron.trim()} onClick={() => void create()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CalendarClock className="size-3.5" aria-hidden />}
          添加
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <span>时区</span>
        <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="h-8 w-44 font-mono text-xs" aria-label="时区" />
        <span>每周一 9 点是 <code className="font-mono">0 9 * * 1</code></span>
      </div>

      {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      {loading && schedules.length === 0 ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          正在读取定时任务
        </div>
      ) : schedules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">还没有定时任务。</div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {schedules.map((schedule) => (
            <li key={schedule.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{schedule.task_title}</p>
                <p className="font-mono text-caption text-muted-foreground">
                  {schedule.cron} · {schedule.timezone} · {schedule.missed_policy === 'run_once' ? '补跑一次' : '超过 24h 跳过'}
                </p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  下次 {schedule.next_run_at ? new Date(schedule.next_run_at).toLocaleString('zh-CN') : '—'}
                  {schedule.last_status && <span> · 上次 {schedule.last_status}</span>}
                  {schedule.last_error && <span className="text-destructive"> · {schedule.last_error}</span>}
                </p>
              </div>
              <StatusPill status={schedule.task_status} />
              <Button variant="outline" size="sm" onClick={() => void toggle(schedule)}>
                {schedule.enabled === 1 ? '停用' : '启用'}
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="删除定时" onClick={() => void remove(schedule)}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
