import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Check,
  ClipboardList,
  HardDrive,
  History,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  approvalPayload,
  coworkStepLabel,
  isPlanApproval,
  pendingApprovals,
  useCoworkStore,
} from '@/stores/cowork'
import type {
  CoworkApproval,
  CoworkArtifact,
  CoworkEvent,
  CoworkFileBackup,
  CoworkModelRouteSummary,
  CoworkStep,
} from '@/types/cowork'
import {
  baseName,
  ConnectBadge,
  parseCoworkJson,
  SectionCard,
  StatusPill,
  StepIcon,
} from './taskUi'
import { CoworkArtifactStudio } from './CoworkArtifactStudio'
import { ArtifactsList, FileBackupsSection } from './TaskDetailArtifacts'
import { TaskPassportCard } from './TaskPassportCard'

function PlanApprovalCard({ approval, busy, onDecide }: {
  approval: CoworkApproval
  busy: boolean
  onDecide: (id: string, action: 'approve' | 'reject' | 'modify', options?: { reason?: string; modified_plan?: string }) => void
}) {
  const payload = approvalPayload(approval)
  const planText = typeof payload.plan_text === 'string' ? payload.plan_text : ''
  const steps = Array.isArray(payload.steps) ? payload.steps.map(String) : []
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [draft, setDraft] = useState(planText)

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
          <ClipboardList className="size-4 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">计划等待批准</h3>
          <p className="mt-0.5 text-caption text-muted-foreground">
            批准后才会开始写产物。计划 10 分钟内有效。
          </p>
        </div>
      </div>

      {editing ? (
        <Textarea
          className="mt-3 min-h-44 font-mono text-xs leading-relaxed"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="修改后的计划"
        />
      ) : steps.length > 0 ? (
        <div className="mt-3">
          <ol className="space-y-1.5">
            {steps.map((step, index) => (
              <li key={`${index}-${step}`} className="flex gap-2 text-sm text-foreground">
                <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="mt-2 text-caption text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setShowRaw((value) => !value)}
          >
            {showRaw ? '收起原始计划' : '查看原始计划'}
          </button>
          {showRaw && (
            <div className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-background/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              {planText}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-background/60 px-3 py-2.5 text-sm leading-relaxed text-foreground">
          模型没有附带计划正文；步骤见下方。
        </div>
      )}

      <Input
        className="mt-3"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="备注（可选，例如拒绝原因）"
        aria-label="审批备注"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={() => onDecide(approval.id, 'modify', { modified_plan: draft, reason })}
            >
              保存并执行修改后的计划
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              取消修改
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" disabled={busy} onClick={() => onDecide(approval.id, 'approve', { reason })}>
              <Check className="size-3.5" aria-hidden />
              批准并执行
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setDraft(planText); setEditing(true) }}>
              修改计划
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => onDecide(approval.id, 'reject', { reason })}
            >
              拒绝
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function ToolApprovalCard({ approval, busy, onDecide }: {
  approval: CoworkApproval
  busy: boolean
  onDecide: (id: string, action: 'approve' | 'reject', options?: { reason?: string }) => void
}) {
  const payload = approvalPayload(approval)
  const question = typeof payload.question === 'string' ? payload.question : 'Agent 请求执行一个需要确认的操作'
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '未知工具'
  const risk = typeof payload.risk_level === 'string' ? payload.risk_level : 'medium'
  const toolInput = typeof payload.tool_input === 'string' ? payload.tool_input : ''
  const [reason, setReason] = useState('')

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-destructive/10">
          <AlertTriangle className="size-4 text-destructive" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">操作等待批准</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{question}</p>
          <p className="mt-1.5 text-caption text-muted-foreground">
            工具 <code className="rounded bg-panel px-1 py-0.5 font-mono text-foreground">{toolName}</code>
            <span className="mx-1.5" aria-hidden>·</span>
            风险 {risk}
            <span className="mx-1.5" aria-hidden>·</span>
            5 分钟内有效
          </p>
        </div>
      </div>
      {toolInput && (
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          {toolInput}
        </pre>
      )}
      <Input
        className="mt-3"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="备注（可选）"
        aria-label="审批备注"
      />
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => onDecide(approval.id, 'approve', { reason })}>
          <Check className="size-3.5" aria-hidden />
          允许
        </Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => onDecide(approval.id, 'reject', { reason })}>
          <X className="size-3.5" aria-hidden />
          拒绝
        </Button>
      </div>
    </div>
  )
}

function StepsTimeline({ steps }: { steps: CoworkStep[] }) {
  if (steps.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Agent 还没有提交步骤。</p>
  }
  return (
    <ol className="divide-y divide-border">
      {steps.map((step, index) => {
        const detail = parseCoworkJson(step.detail_json)
        const detailText = typeof detail.detail === 'string' ? detail.detail : ''
        return (
          <li key={step.id} className="flex gap-3 px-4 py-3">
            <div className="flex flex-col items-center">
              <StepIcon status={step.status} />
              {index < steps.length - 1 && <span className="mt-1 h-full w-px flex-1 bg-border" aria-hidden />}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-caption text-muted-foreground">{String(step.seq).padStart(2, '0')}</span>
                <span className={cn(
                  'text-sm',
                  step.status === 'completed' ? 'text-muted-foreground line-through decoration-border' : 'text-foreground',
                )}>
                  {step.label}
                </span>
                <span className="text-caption text-muted-foreground">{coworkStepLabel(step.status)}</span>
              </div>
              {detailText && <p className="mt-1 whitespace-pre-wrap text-caption text-muted-foreground">{detailText}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function parseRouteEvent(events: CoworkEvent[]): Record<string, unknown> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'cowork.model.routed') continue
    return event.payload ?? parseCoworkJson(event.payload_json)
  }
  return null
}

function routeBadgeText(payload: Record<string, unknown>): string {
  const location = payload.location === 'local' ? '本机' : '云端'
  const provider = String(payload.provider_label ?? payload.provider_id ?? '模型')
  const model = String(payload.model ?? '')
  const cost = payload.cost && typeof payload.cost === 'object'
    ? (payload.cost as Record<string, unknown>).estimated_usd
    : null
  const costText = location === '本机'
    ? '无 API 费用'
    : typeof cost === 'number'
      ? `约 $${cost.toFixed(4)}`
      : '价格未知'
  return `${provider} · ${model} · ${location} · ${costText}`
}

function describeEvent(event: CoworkEvent): string {
  const payload = event.payload ?? parseCoworkJson(event.payload_json)
  switch (event.type) {
    case 'cowork.task.created': return '任务已创建'
    case 'cowork.task.inputs.updated': return '任务输入已更新'
    case 'cowork.schedule.created': return '定时任务已创建'
    case 'cowork.schedule.triggered': return '定时任务已触发'
    case 'cowork.schedule.skipped': return `定时任务已跳过：${payload.reason ?? ''}`.trim()
    case 'cowork.schedule.failed': return `定时任务失败：${payload.error ?? ''}`.trim()
    case 'cowork.run.started': return `开始第 ${payload.attempt ?? '?'} 次运行`
    case 'cowork.plan.requested': return '已请求计划，等待模型提交'
    case 'cowork.plan.proposed': return '计划已提交，等待批准'
    case 'cowork.plan.approved': return '计划已批准'
    case 'cowork.plan.rejected': return '计划被拒绝'
    case 'cowork.plan.completed': return '计划阶段完成'
    case 'cowork.approval.requested': return `请求${payload.kind === 'plan' ? '计划' : '操作'}审批`
    case 'cowork.approval.resolved': return `审批已处理：${payload.status ?? ''}`
    case 'cowork.steps.updated': return `步骤更新${payload.count ? `（${payload.count} 项）` : ''}`
    case 'cowork.tool.started': return `调用工具 ${payload.tool_name ?? ''}`.trim()
    case 'cowork.tool.completed': return `工具完成 ${payload.tool_name ?? ''}`.trim()
    case 'cowork.tool.failed': return `工具失败 ${payload.tool_name ?? ''}`.trim()
    case 'cowork.tool.decided': return `工具审批：${payload.decision ?? payload.status ?? ''}`
    case 'cowork.artifact.created': return `生成产物 ${payload.path ? baseName(String(payload.path)) : ''}`.trim()
    case 'cowork.artifact.exported': return `产物已导出 ${payload.path ? baseName(String(payload.path)) : ''}`.trim()
    case 'cowork.artifact.deleted': return `产物已移入回收站 ${payload.path ? baseName(String(payload.path)) : ''}`.trim()
    case 'cowork.file.restored': return '文件已从备份恢复'
    case 'cowork.model.routed': return `模型路由：${payload.provider_label ?? payload.provider_id ?? ''} · ${payload.model ?? ''}`.trim()
    case 'cowork.approval.batch': return '低风险只读操作已批量批准'
    case 'cowork.answer': return 'Agent 回复已记录'
    case 'cowork.run.paused': return '任务已暂停'
    case 'cowork.run.resumed': return '任务已恢复'
    case 'cowork.run.interrupted': return '应用重启，任务已转为暂停'
    case 'cowork.run.completed': return '运行完成，等待验收'
    case 'cowork.run.failed': return `运行失败：${payload.error ?? ''}`.trim()
    case 'cowork.run.cancelled': return '任务已取消'
    case 'cowork.task.completed': return '任务已验收完成'
    case 'cowork.agent.error': return `Agent 错误：${payload.message ?? ''}`.trim()
    default: return event.type
  }
}

function EventLog({ events }: { events: CoworkEvent[] }) {
  if (events.length === 0) return <p className="px-4 py-5 text-sm text-muted-foreground">还没有运行事件。</p>
  const last = events.slice(-20)
  return (
    <ul className="divide-y divide-border">
      {last.map((event) => (
        <li key={event.id} className="flex items-start gap-3 px-4 py-2.5">
          <History className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">{describeEvent(event)}</p>
            <p className="mt-0.5 font-mono text-caption text-muted-foreground">
              #{event.id} <span aria-hidden>·</span> {new Date(event.created_at).toLocaleTimeString('zh-CN')}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function DetailActions({ onAccept, onPackage, hasArtifacts }: {
  onAccept: () => void
  onPackage: () => void
  hasArtifacts: boolean
}) {
  const task = useCoworkStore((state) => state.detail?.task ?? null)
  const action = useCoworkStore((state) => state.action)
  const runTask = useCoworkStore((state) => state.runTask)
  const pauseTask = useCoworkStore((state) => state.pauseTask)
  const resumeTask = useCoworkStore((state) => state.resumeTask)
  const cancelTask = useCoworkStore((state) => state.cancelTask)
  const [confirming, setConfirming] = useState<'run' | 'resume' | null>(null)
  const [route, setRoute] = useState<CoworkModelRouteSummary | null>(null)
  const [routeError, setRouteError] = useState('')
  if (!task) return null
  const busy = Boolean(action)
  const canStart = ['draft', 'failed', 'cancelled'].includes(task.status)
  const canPause = ['planning', 'awaiting_plan', 'running', 'awaiting_approval'].includes(task.status)
  const canResume = task.status === 'paused'
  const canCancel = !['completed', 'cancelled'].includes(task.status)
  const canAccept = task.status === 'review'
  const needsCloudConfirm = task.data_policy !== 'local_only'
  const taskId = task.id
  const objectiveChars = task.objective.length

  async function begin(kind: 'run' | 'resume'): Promise<void> {
    setRouteError('')
    if (!needsCloudConfirm) {
      if (kind === 'run') await runTask()
      else await resumeTask()
      return
    }
    try {
      const result = await api.previewCoworkModelRoute({
        task_id: taskId,
        prompt_chars: Math.max(200, objectiveChars),
      })
      setRoute(result.route)
      setConfirming(kind)
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canStart && (
          <Button size="sm" disabled={busy} onClick={() => void begin('run')}>
            {action === 'run' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            开始执行
          </Button>
        )}
        {canResume && (
          <Button size="sm" disabled={busy} onClick={() => void begin('resume')}>
            {action === 'resume' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
            恢复
          </Button>
        )}
        {canPause && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void pauseTask()}>
            {action === 'pause' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
            暂停
          </Button>
        )}
        {canAccept && (
          <Button size="sm" disabled={busy} onClick={onAccept}>
            {action === 'accept' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
            验收完成
          </Button>
        )}
        {hasArtifacts && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onPackage} title="包含产物、来源清单与 README 的 ZIP">
            <Archive className="size-3.5" aria-hidden />
            交付包
          </Button>
        )}
        {canCancel && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void cancelTask()}>
            {action === 'cancel' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Square className="size-3.5" aria-hidden />}
            取消
          </Button>
        )}
      </div>
      {routeError && <p className="mt-2 text-caption text-destructive">模型预检失败：{routeError}</p>}
      <Dialog open={Boolean(confirming)} onOpenChange={(open) => { if (!open) setConfirming(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>发送前确认</DialogTitle>
            <DialogDescription>
              {task.data_policy === 'cloud'
                ? '这个任务允许云端模型。确认后才会开始运行，可能把任务资料发送给云端渠道。'
                : '确认后开始运行。'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-panel/50 p-3 text-sm">
            <p className="font-medium text-foreground">{route ? routeBadgeText({
              location: route.location,
              provider_label: route.provider_label,
              model: route.model,
              cost: { estimated_usd: route.cost.estimated_usd },
            }) : '正在检查模型路由…'}</p>
            {route && <p className="mt-1 text-caption leading-relaxed text-muted-foreground">{route.reason}。{route.cost.note}</p>}
            {route?.fallback && <p className="mt-1 text-caption text-muted-foreground">已回退：{route.fallback.from_model} → {route.model}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>取消</Button>
            <Button
              disabled={busy}
              onClick={() => {
                const kind = confirming
                setConfirming(null)
                if (kind === 'run') void runTask()
                if (kind === 'resume') void resumeTask()
              }}
            >
              <Play className="size-4" aria-hidden />
              确认并开始
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function TaskDetail({ onDownload, onOpenApprovals }: {
  onDownload: (artifact: CoworkArtifact) => void
  onOpenApprovals: () => void
}) {
  const detail = useCoworkStore((state) => state.detail)
  const detailLoading = useCoworkStore((state) => state.detailLoading)
  const action = useCoworkStore((state) => state.action)
  const connection = useCoworkStore((state) => state.connection)
  const fileBackups = useCoworkStore((state) => state.fileBackups)
  const decideApproval = useCoworkStore((state) => state.decideApproval)
  const refreshDetail = useCoworkStore((state) => state.refreshDetail)
  const acceptTask = useCoworkStore((state) => state.acceptTask)
  const restoreFileBackup = useCoworkStore((state) => state.restoreFileBackup)
  const requestArtifactExport = useCoworkStore((state) => state.requestArtifactExport)
  const requestArtifactDelete = useCoworkStore((state) => state.requestArtifactDelete)
  const [studio, setStudio] = useState<CoworkArtifact | null>(null)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [memoryDraft, setMemoryDraft] = useState('')
  const [writeMemory, setWriteMemory] = useState(true)
  const [acceptBusy, setAcceptBusy] = useState(false)
  const [acceptError, setAcceptError] = useState('')
  const [acceptNote, setAcceptNote] = useState('')
  const [actionNote, setActionNote] = useState('')
  const [packageBusy, setPackageBusy] = useState(false)
  const detailArtifacts = detail?.artifacts

  // 产物 SSE 只刷新 detail；打开中的弹层要跟随同一路径的最新版本，
  // 否则 Agent 写入新版本后，用户仍盯着旧字节。
  useEffect(() => {
    setStudio((current) => {
      if (!current) return current
      const latest = (detailArtifacts ?? [])
        .filter((artifact) => artifact.path === current.path)
        .sort((a, b) => b.version - a.version)[0]
      return latest && latest.id !== current.id ? latest : current
    })
  }, [detailArtifacts])

  // 弹层打开期间补一个低频对账：SSE 在断线/重启后可能没有新事件可推，
  // 只靠事件会让打开中的预览停在旧版本。
  useEffect(() => {
    if (!studio) return
    const timer = setInterval(() => { void refreshDetail() }, 2000)
    return () => clearInterval(timer)
  }, [studio, refreshDetail])



  function openAccept(): void {
    if (!detail) return
    const { task } = detail
    setMemoryDraft(`${task.title}：${task.objective}`.slice(0, 2000))
    setWriteMemory(Boolean(task.project_id))
    setAcceptError('')
    setAcceptNote('')
    setAcceptOpen(true)
  }

  async function confirmAccept(): Promise<void> {
    if (!detail || acceptBusy) return
    setAcceptBusy(true)
    setAcceptError('')
    try {
      await acceptTask()
      let note = '任务已验收完成。'
      if (writeMemory && detail.task.project_id && memoryDraft.trim()) {
        try {
          await api.addCoworkProjectMemory(detail.task.project_id, memoryDraft.trim(), '验收摘要')
          note = '任务已验收，摘要已写入项目记忆。'
        } catch (err) {
          note = `任务已验收，但项目记忆写入失败：${err instanceof Error ? err.message : String(err)}`
        }
      }
      setAcceptOpen(false)
      setAcceptNote(note)
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : String(err))
    } finally {
      setAcceptBusy(false)
    }
  }


  async function exportArtifact(artifact: CoworkArtifact): Promise<void> {
    setActionNote('')
    const approval = await requestArtifactExport(artifact.id)
    if (!approval) return
    setActionNote(`已创建导出审批：${baseName(artifact.path)}。在审批中心确认后才会写入工作区。`)
    onOpenApprovals()
  }

  async function deleteArtifact(artifact: CoworkArtifact): Promise<void> {
    setActionNote('')
    const approval = await requestArtifactDelete(artifact.id)
    if (!approval) return
    setActionNote(`已创建删除审批：${baseName(artifact.path)}。确认后产物移入任务回收站，可恢复。`)
    onOpenApprovals()
  }

  async function downloadPackage(): Promise<void> {
    if (!detail || packageBusy) return
    setPackageBusy(true)
    setActionNote('')
    try {
      const url = await api.prepareCoworkPackage(detail.task.id)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.rel = 'noopener'
      anchor.download = `${detail.task.title}-交付包.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch (err) {
      setActionNote(err instanceof Error ? err.message : String(err))
    } finally {
      setPackageBusy(false)
    }
  }

  async function restore(backup: CoworkFileBackup): Promise<void> {
    setActionNote('')
    await restoreFileBackup(backup.id)
    setActionNote(`已恢复 ${baseName(backup.original_path)}；恢复前版本也已自动备份。`)
  }

  if (detailLoading && !detail) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        正在读取任务
      </div>
    )
  }
  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        选择左侧任务查看计划、步骤与产物。
      </div>
    )
  }

  const { task, steps, artifacts, events, latest_run: latestRun } = detail
  const pending = pendingApprovals(detail)
  const routeEvent = parseRouteEvent(events)
  // 审批卡只在对应状态显示；旧轮/已恢复任务可能残留 pending 记录，不能当作可操作。
  const planApproval = task.status === 'awaiting_plan' ? pending.find(isPlanApproval) ?? null : null
  const toolApprovals = task.status === 'awaiting_approval'
    ? pending.filter((approval) => !isPlanApproval(approval))
    : []
  const artifactApprovals = pending.filter((approval) => approval.kind === 'export' || approval.kind === 'delete')
  const busy = Boolean(action)

  return (
    <div className="flex flex-col gap-4 p-5">
      <header className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={task.status} />
              <ConnectBadge connection={connection} />
              <span className={
                task.data_policy === 'local_only'
                  ? 'inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-1 text-caption text-success'
                  : 'inline-flex items-center gap-1 rounded-full border border-border bg-panel px-2 py-1 text-caption text-muted-foreground'
              }>
                {task.data_policy === 'local_only' ? <HardDrive className="size-3" aria-hidden /> : <ShieldCheck className="size-3" aria-hidden />}
                {task.data_policy === 'local_only' ? '仅本地 · 0 云端请求' : '允许云端'}
              </span>
              {latestRun && (
                <span className="text-caption text-muted-foreground">
                  第 {latestRun.attempt} 次运行
                </span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{task.title}</h1>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{task.objective}</p>
          </div>
          <DetailActions
            onAccept={openAccept}
            onPackage={() => void downloadPackage()}
            hasArtifacts={artifacts.length > 0 && !packageBusy}
          />
        </div>
        <dl className="mt-4 grid gap-2 border-t border-border pt-3 text-caption sm:grid-cols-2">
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-muted-foreground">源工作区</dt>
            <dd className="truncate font-mono text-foreground" title={task.workspace_root}>{task.workspace_root}</dd>
          </div>
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-muted-foreground">产物目录</dt>
            <dd className="truncate font-mono text-foreground" title={task.staging_root}>{task.staging_root}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">权限</dt>
            <dd className="text-foreground">{task.permission_mode}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">更新时间</dt>
            <dd className="text-foreground">{new Date(task.updated_at).toLocaleString('zh-CN')}</dd>
          </div>
        </dl>
        {routeEvent && (
          <p className="mt-3 rounded-md border border-border bg-panel/50 px-3 py-2 text-caption text-muted-foreground">
            <span className="font-medium text-foreground">本次模型路由</span>
            <span className="mx-1.5" aria-hidden>·</span>
            {routeBadgeText(routeEvent)}
            {typeof routeEvent.reason === 'string' && <><br />{routeEvent.reason}</>}
          </p>
        )}
        {latestRun?.error && (
          <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {latestRun.error}
          </p>
        )}
      </header>

      {artifacts.length > 0 && (
        <TaskPassportCard taskId={task.id} status={task.status} artifactCount={artifacts.length} updatedAt={task.updated_at} />
      )}

      {acceptNote && (
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{acceptNote}</p>
      )}
      {actionNote && (
        <p className="rounded-md border border-border bg-panel/50 px-3 py-2 text-sm text-foreground">{actionNote}</p>
      )}
      {artifactApprovals.length > 0 && (
        <button
          type="button"
          onClick={onOpenApprovals}
          className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-left text-sm text-foreground transition-colors duration-fast ease-standard hover:bg-primary/10"
        >
          <span>{artifactApprovals.length} 个导出/删除审批等待确认；确认后才会改动工作区文件。</span>
          <span className="shrink-0 text-caption text-primary">打开审批中心 →</span>
        </button>
      )}

      {planApproval && (
        <PlanApprovalCard
          approval={planApproval}
          busy={busy}
          onDecide={(id, act, options) => void decideApproval(id, act, options)}
        />
      )}
      {toolApprovals.map((approval) => (
        <ToolApprovalCard
          key={approval.id}
          approval={approval}
          busy={busy}
          onDecide={(id, act, options) => void decideApproval(id, act, options)}
        />
      ))}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title="执行步骤" extra={<span className="text-caption text-muted-foreground">{steps.length} 步</span>}>
            <StepsTimeline steps={steps} />
          </SectionCard>
          <SectionCard title="交付物" extra={<span className="text-caption text-muted-foreground">{artifacts.length} 个</span>}>
            <ArtifactsList
              artifacts={artifacts}
              onDownload={onDownload}
              onPreview={setStudio}
              onExport={(artifact) => void exportArtifact(artifact)}
              onDelete={(artifact) => void deleteArtifact(artifact)}
            />
          </SectionCard>
          <FileBackupsSection backups={fileBackups} busy={busy} onRestore={(backup) => void restore(backup)} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title="运行日志">
            <EventLog events={events} />
          </SectionCard>
        </div>
      </div>
      <Dialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>验收并写入项目记忆</DialogTitle>
            <DialogDescription>
              {task.project_id
                ? '验收会把任务标记为完成；只有你勾选并确认，摘要才会写入项目记忆。'
                : '这个任务不属于项目，验收后不会写入项目记忆。'}
            </DialogDescription>
          </DialogHeader>
          {task.project_id ? (
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 rounded border-border"
                  checked={writeMemory}
                  onChange={(event) => setWriteMemory(event.target.checked)}
                />
                把验收摘要写进项目记忆
              </label>
              {writeMemory && (
                <Textarea
                  className="min-h-32 text-sm"
                  value={memoryDraft}
                  onChange={(event) => setMemoryDraft(event.target.value)}
                  maxLength={2000}
                  aria-label="项目记忆摘要"
                />
              )}
              {writeMemory && (
                <p className="text-caption text-muted-foreground">在项目设置的「项目记忆」里可以搜到这条摘要。</p>
              )}
            </div>
          ) : null}
          {acceptError && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{acceptError}</p>}
          <DialogFooter>
            <Button variant="ghost" disabled={acceptBusy} onClick={() => setAcceptOpen(false)}>取消</Button>
            <Button disabled={acceptBusy} onClick={() => void confirmAccept()}>
              {acceptBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
              验收完成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {studio && (
        <CoworkArtifactStudio
          taskId={task.id}
          artifact={studio}
          onClose={() => setStudio(null)}
        />
      )}
    </div>
  )
}
