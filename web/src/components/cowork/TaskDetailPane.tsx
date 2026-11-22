import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  FileText,
  History,
  Loader2,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Square,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
  CoworkStep,
} from '@/types/cowork'
import {
  baseName,
  ConnectBadge,
  formatBytes,
  parseCoworkJson,
  SectionCard,
  StatusPill,
  StepIcon,
} from './taskUi'
import { CoworkArtifactStudio } from './CoworkArtifactStudio'

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
      ) : (
        <div className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-background/60 px-3 py-2.5 text-sm leading-relaxed text-foreground">
          {planText.trim() || '模型没有附带计划正文；步骤见下方。'}
        </div>
      )}

      {steps.length > 0 && !editing && (
        <ol className="mt-3 space-y-1.5">
          {steps.map((step, index) => (
            <li key={`${index}-${step}`} className="flex gap-2 text-sm text-foreground">
              <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
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

function ArtifactsList({ artifacts, onDownload, onPreview }: {
  artifacts: CoworkArtifact[]
  onDownload: (artifact: CoworkArtifact) => void
  onPreview: (artifact: CoworkArtifact) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  if (artifacts.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">还没有交付物。产物只会落在任务 staging 目录。</p>
  }
  const groups = new Map<string, CoworkArtifact[]>()
  for (const artifact of artifacts) {
    const list = groups.get(artifact.path) ?? []
    list.push(artifact)
    groups.set(artifact.path, list)
  }
  const ordered = [...groups.values()]
    .map((list) => list.sort((a, b) => b.version - a.version))
    .sort((a, b) => (b[0]?.created_at ?? '').localeCompare(a[0]?.created_at ?? ''))

  return (
    <ul className="divide-y divide-border">
      {ordered.map((versions) => {
        const current = versions[0]!
        const older = versions.slice(1)
        const open = Boolean(expanded[current.path])
        return (
          <li key={current.path} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-panel">
                <FileText className="size-4 text-muted-foreground" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{baseName(current.path)}</p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  v{current.version} <span aria-hidden>·</span> {formatBytes(current.size_bytes)}
                  <span className="mx-1.5" aria-hidden>·</span>
                  <code className="font-mono">{current.sha256.slice(0, 10)}</code>
                  {older.length > 0 && <span className="ml-1.5">· {older.length} 个历史版本</span>}
                </p>
              </div>
              {['docx', 'xlsx', 'pptx'].includes(current.kind) && (
                <Button variant="ghost" size="sm" onClick={() => onPreview(current)}>
                  <PencilLine className="size-3.5" aria-hidden />
                  预览 / 选改
                </Button>
              )}
              {older.length > 0 && (
                <Button variant="ghost" size="icon-sm" aria-label="历史版本" onClick={() => setExpanded((state) => ({ ...state, [current.path]: !open }))}>
                  {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => onDownload(current)}>
                <Download className="size-3.5" aria-hidden />
                下载
              </Button>
            </div>
            {open && older.length > 0 && (
              <ul className="mt-2 ml-12 divide-y divide-border rounded-md border border-border bg-muted/25">
                {older.map((version) => (
                  <li key={version.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="shrink-0 rounded-sm border border-border bg-card px-2 py-1.5 font-mono text-caption text-muted-foreground">v{version.version}</span>
                    <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                      {formatBytes(version.size_bytes)} <span aria-hidden>·</span> {new Date(version.created_at).toLocaleString('zh-CN')}
                    </span>
                    <Button variant="ghost" size="icon-xs" aria-label={`预览 v${version.version}`} onClick={() => onPreview(version)}>
                      <Eye className="size-3.5" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={`下载 v${version.version}`} onClick={() => onDownload(version)}>
                      <Download className="size-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function describeEvent(event: CoworkEvent): string {
  const payload = event.payload ?? parseCoworkJson(event.payload_json)
  switch (event.type) {
    case 'cowork.task.created': return '任务已创建'
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

function DetailActions() {
  const task = useCoworkStore((state) => state.detail?.task ?? null)
  const action = useCoworkStore((state) => state.action)
  const runTask = useCoworkStore((state) => state.runTask)
  const pauseTask = useCoworkStore((state) => state.pauseTask)
  const resumeTask = useCoworkStore((state) => state.resumeTask)
  const cancelTask = useCoworkStore((state) => state.cancelTask)
  const acceptTask = useCoworkStore((state) => state.acceptTask)
  if (!task) return null
  const busy = Boolean(action)
  const canStart = ['draft', 'failed', 'cancelled'].includes(task.status)
  const canPause = ['planning', 'awaiting_plan', 'running', 'awaiting_approval'].includes(task.status)
  const canResume = task.status === 'paused'
  const canCancel = !['completed', 'cancelled'].includes(task.status)
  const canAccept = task.status === 'review'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canStart && (
        <Button size="sm" disabled={busy} onClick={() => void runTask()}>
          {action === 'run' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          开始执行
        </Button>
      )}
      {canResume && (
        <Button size="sm" disabled={busy} onClick={() => void resumeTask()}>
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
        <Button size="sm" disabled={busy} onClick={() => void acceptTask()}>
          {action === 'accept' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          验收完成
        </Button>
      )}
      {canCancel && (
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => void cancelTask()}>
          {action === 'cancel' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Square className="size-3.5" aria-hidden />}
          取消
        </Button>
      )}
    </div>
  )
}

export function TaskDetail({ onDownload }: { onDownload: (artifact: CoworkArtifact) => void }) {
  const detail = useCoworkStore((state) => state.detail)
  const detailLoading = useCoworkStore((state) => state.detailLoading)
  const action = useCoworkStore((state) => state.action)
  const connection = useCoworkStore((state) => state.connection)
  const decideApproval = useCoworkStore((state) => state.decideApproval)
  const [studio, setStudio] = useState<CoworkArtifact | null>(null)

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
  // 审批卡只在对应状态显示；旧轮/已恢复任务可能残留 pending 记录，不能当作可操作。
  const planApproval = task.status === 'awaiting_plan' ? pending.find(isPlanApproval) ?? null : null
  const toolApprovals = task.status === 'awaiting_approval'
    ? pending.filter((approval) => !isPlanApproval(approval))
    : []
  const busy = Boolean(action)

  return (
    <div className="flex flex-col gap-4 p-5">
      <header className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={task.status} />
              <ConnectBadge connection={connection} />
              {latestRun && (
                <span className="text-caption text-muted-foreground">
                  第 {latestRun.attempt} 次运行
                </span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{task.title}</h1>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{task.objective}</p>
          </div>
          <DetailActions />
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
        {latestRun?.error && (
          <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {latestRun.error}
          </p>
        )}
      </header>

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
            <ArtifactsList artifacts={artifacts} onDownload={onDownload} onPreview={setStudio} />
          </SectionCard>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title="运行日志">
            <EventLog events={events} />
          </SectionCard>
        </div>
      </div>
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
