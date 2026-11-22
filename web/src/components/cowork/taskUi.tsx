import type { ReactNode } from 'react'
import {
  CheckCircle2,
  Circle,
  ClipboardList,
  Loader2,
  Plus,
  XCircle,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { coworkStatusLabel } from '@/stores/cowork'
import type { CoworkTask } from '@/types/cowork'

export function parseCoworkJson(json: string | undefined): Record<string, unknown> {
  if (!json) return {}
  try {
    const value = JSON.parse(json)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function relativeTime(iso: string): string {
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const tail = normalized.split('/').filter(Boolean).pop()
  return tail || path
}

export function statusTone(status: string): string {
  if (status === 'completed' || status === 'review') return 'border-success/30 bg-success/10 text-success'
  if (status === 'running' || status === 'planning') return 'border-primary/30 bg-primary/10 text-primary'
  if (status === 'failed') return 'border-destructive/30 bg-destructive/10 text-destructive'
  if (status === 'awaiting_plan' || status === 'awaiting_approval') return 'border-border bg-panel text-foreground'
  return 'border-border bg-panel text-muted-foreground'
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-caption font-medium', statusTone(status))}>
      {coworkStatusLabel(status)}
    </span>
  )
}

export function StepIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="size-4 text-success" aria-hidden />
  if (status === 'running') return <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
  if (status === 'failed') return <XCircle className="size-4 text-destructive" aria-hidden />
  if (status === 'skipped') return <Circle className="size-4 text-muted-foreground/50" aria-hidden />
  return <Circle className="size-4 text-muted-foreground" aria-hidden />
}

export function SectionCard({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {extra}
      </header>
      {children}
    </section>
  )
}

export function ConnectBadge({ connection }: { connection: string }) {
  const text = connection === 'open'
    ? '实时事件已连接'
    : connection === 'connecting'
      ? '正在连接事件流'
      : connection === 'reconnecting'
        ? '事件流重连中'
        : '事件流未连接'
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
      <span className={cn(
        'size-1.5 rounded-full',
        connection === 'open' ? 'bg-success' : connection === 'reconnecting' ? 'bg-destructive' : 'bg-muted-foreground',
      )} />
      {text}
    </span>
  )
}

export function TaskListItem({ task, active, onSelect }: { task: CoworkTask; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-primary/30 bg-primary/8'
          : 'border-transparent bg-transparent hover:bg-accent/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-medium text-foreground">{task.title}</span>
        <span className={cn('mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-micro', statusTone(task.status))}>
          {coworkStatusLabel(task.status)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-caption text-muted-foreground">
        <span className="truncate">{baseName(task.workspace_root)}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">{relativeTime(task.updated_at)}</span>
      </div>
    </button>
  )
}

export function EmptyState({ onCreate }: { onCreate: () => void }) {
  const steps = [
    { title: '选一个文件夹', detail: '只读取这里；源文件不会被直接改。' },
    { title: '写一句目标', detail: '可以直接套用周报、论文摘要或表格汇总模板。' },
    { title: '批准计划，再看产物', detail: '先批准再执行；产物在独立 staging，验收后才交付。' },
  ]
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-xl">
        <div className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-border bg-card">
            <ClipboardList className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <h2 className="mt-4 text-base font-semibold text-foreground">第一条任务，三步开始</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            不需要配置模型地址或权限文件。选文件夹、写目标、批准计划，就能拿到可回滚的产物。
          </p>
        </div>
        <ol className="mt-5 grid gap-2 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-lg border border-border bg-card p-3">
              <span className="flex size-6 items-center justify-center rounded-full border border-border bg-panel font-mono text-caption text-muted-foreground">
                {index + 1}
              </span>
              <p className="mt-2 text-sm font-medium text-foreground">{step.title}</p>
              <p className="mt-1 text-caption leading-relaxed text-muted-foreground">{step.detail}</p>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex justify-center">
          <Button onClick={onCreate}>
            <Plus className="size-4" aria-hidden />
            新建第一条任务
          </Button>
        </div>
      </div>
    </div>
  )
}
