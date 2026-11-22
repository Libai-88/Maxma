import { useEffect, useState } from 'react'
import { Clock3, Loader2, RefreshCw } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { relativeTime } from '@/components/cowork/taskUi'
import type { CoworkActivityEvent } from '@/types/cowork'

const LABELS: Record<string, string> = {
  'cowork.task.created': '任务已创建',
  'cowork.task.inputs.updated': '任务输入已更新',
  'cowork.task.planning.started': '开始计划',
  'cowork.task.plan.ready': '计划已生成',
  'cowork.task.approval.requested': '等待审批',
  'cowork.task.approved': '计划已批准',
  'cowork.task.run.started': '开始执行',
  'cowork.task.run.completed': '执行完成',
  'cowork.task.run.failed': '执行失败',
  'cowork.artifact.created': '生成产物',
  'cowork.artifact.updated': '产物已更新',
  'cowork.schedule.created': '定时已创建',
  'cowork.schedule.removed': '定时已删除',
  'cowork.schedule.triggered': '定时已触发',
  'cowork.schedule.skipped': '定时已跳过',
  'cowork.schedule.failed': '定时失败',
  'cowork.project.created': '项目已创建',
  'cowork.project.updated': '项目已更新',
  'cowork.project.asset.added': '资产已加入',
  'cowork.project.asset.removed': '资产已移除',
  'cowork.memory.added': '写入项目记忆',
}

function label(type: string): string {
  return LABELS[type] ?? type
}

function eventMessage(event: CoworkActivityEvent): string {
  try {
    const parsed = JSON.parse(event.payload_json) as Record<string, unknown>
    for (const key of ['message', 'summary', 'detail', 'title']) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim()) return value
    }
  } catch {
    return ''
  }
  return ''
}

export function CoworkActivityDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [events, setEvents] = useState<CoworkActivityEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const data = await api.coworkActivity(60)
      setEvents(data.activity)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock3 className="size-4 text-muted-foreground" aria-hidden />
            活动中心
          </DialogTitle>
          <DialogDescription>跨任务与项目的最新事件；只展示已落库事实，不推断成功。</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            刷新
          </Button>
        </div>
        {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="max-h-[55vh] overflow-y-auto scrollbar-thin">
          <ActivityList events={events} loading={loading} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ActivityList({ events, loading }: { events: CoworkActivityEvent[]; loading: boolean }) {
  if (loading && events.length === 0) {
    return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />正在读取活动</div>
  }
  if (events.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">还没有活动。</p>
  }
  return (
    <ul className="divide-y divide-border">
      {events.map((event) => (
        <li key={event.id} className="flex items-start gap-3 px-1 py-2.5">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">
              <span className="font-medium">{label(event.type)}</span>
              <span className="text-muted-foreground"> · {event.task_title}</span>
            </p>
            {eventMessage(event) && <p className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">{eventMessage(event)}</p>}
            <p className="mt-0.5 text-caption text-muted-foreground">
              {relativeTime(event.created_at)}
              {event.project_id && <span> · 项目 {event.project_id}</span>}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
