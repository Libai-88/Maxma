import { useEffect, useRef, useState } from 'react'
import { FolderOpen, HardDrive, Loader2, Plus, ShieldCheck, Sparkles } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MODE_LABELS, MODE_ORDER } from '@/hooks/useSessionPermissionMode'
import { useCoworkStore } from '@/stores/cowork'
import type { CoworkModelProfile, CoworkModelRouteSummary } from '@/types/cowork'

const PROFILE_OPTIONS: Array<{ value: CoworkModelProfile; label: string; detail: string }> = [
  { value: 'private', label: '隐私优先', detail: '只用本机模型；本机不可用就失败，不切换云端。' },
  { value: 'balanced', label: '平衡', detail: '优先本机；本机不可用且允许云端时才切换。' },
  { value: 'quality', label: '质量优先', detail: '优先云端；没有云端时回落本机。可能产生费用。' },
]

const TASK_TEMPLATES = [
  { label: '整理周报', title: '整理本周工作周报', objective: '读取工作区里的本周记录，整理成一份给老师看的周报，包含进展、问题与下周计划。' },
  { label: '论文摘要', title: '读论文并写摘要', objective: '阅读工作区里的论文，提取研究问题、方法、关键结果与局限，写成 800 字中文摘要，标注页码来源。' },
  { label: '表格汇总', title: '汇总实验数据表', objective: '读取工作区里的表格，合并同类记录，检查缺失值，输出一份带说明的汇总表。' },
]

function routeCostText(route: CoworkModelRouteSummary | null): string {
  if (!route) return ''
  if (route.location === 'local') return '本机模型 · 无 API 费用'
  if (route.cost.estimated_usd === null) return '云端模型 · 价格未知'
  return `云端模型 · 约 $${route.cost.estimated_usd.toFixed(4)}（估算）`
}

export function NewTaskDialog({ open, onOpenChange, projectId, projectTitle, projectRoots = [], projectDataPolicy = 'cloud' }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  projectTitle?: string
  projectRoots?: string[]
  projectDataPolicy?: string
}) {
  const createTask = useCoworkStore((state) => state.createTask)
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [permission, setPermission] = useState('operate')
  const [profile, setProfile] = useState<CoworkModelProfile>('balanced')
  const [route, setRoute] = useState<CoworkModelRouteSummary | null>(null)
  const [routeError, setRouteError] = useState('')
  const [routeLoading, setRouteLoading] = useState(false)
  const [cloudConsent, setCloudConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previewRequest = useRef(0)

  const effectivePolicy = projectDataPolicy === 'local_only' ? 'local_only' : 'cloud'
  const effectiveProfile: CoworkModelProfile = effectivePolicy === 'local_only' ? 'private' : profile

  useEffect(() => {
    if (!open || workspace) return
    const first = projectRoots[0]
    if (first) setWorkspace(first)
  }, [open, projectRoots, workspace])

  useEffect(() => {
    if (!open) return
    const requestId = ++previewRequest.current
    setRouteLoading(true)
    setRouteError('')
    const timer = setTimeout(() => {
      void api.previewCoworkModelRoute({
        project_id: projectId,
        data_policy: effectivePolicy,
        model_policy: { profile: effectiveProfile },
        prompt_chars: Math.max(200, title.length + objective.length),
      }).then((result) => {
        if (previewRequest.current !== requestId) return
        setRoute(result.route)
      }).catch((err) => {
        if (previewRequest.current !== requestId) return
        setRoute(null)
        setRouteError(err instanceof Error ? err.message : String(err))
      }).finally(() => {
        if (previewRequest.current === requestId) setRouteLoading(false)
      })
    }, 450)
    return () => clearTimeout(timer)
  }, [open, projectId, effectivePolicy, effectiveProfile, title, objective])

  function reset(): void {
    setTitle('')
    setObjective('')
    setWorkspace('')
    setPermission('operate')
    setProfile('balanced')
    setRoute(null)
    setRouteError('')
    setCloudConsent(false)
    setBusy(false)
    setError('')
  }

  async function chooseFolder(): Promise<void> {
    setError('')
    try {
      const { path } = await api.selectFolder()
      if (path) setWorkspace(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function submit(): Promise<void> {
    if (!title.trim() || !objective.trim() || !workspace.trim() || busy) return
    if (effectivePolicy === 'cloud' && !cloudConsent) return
    setBusy(true)
    setError('')
    try {
      await createTask({
        title: title.trim(),
        objective: objective.trim(),
        workspace_root: workspace.trim(),
        permission_mode: permission,
        project_id: projectId,
        data_policy: effectivePolicy,
        model_policy: { profile: effectiveProfile },
      })
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next) }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription>
            {projectTitle
              ? `任务会归入「${projectTitle}」，并使用项目的指令、默认模板和资产。`
              : '源工作区只读；产物写入任务自己的 staging 目录，验收后才算交付。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {TASK_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => { setTitle(template.title); setObjective(template.objective) }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-1.5 text-caption text-muted-foreground transition-colors duration-fast ease-standard hover:bg-accent/50 hover:text-foreground"
              >
                <Sparkles className="size-3" aria-hidden />
                {template.label}
              </button>
            ))}
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">标题</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：整理本周实验记录"
              maxLength={200}
              autoFocus
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">目标</span>
            <Textarea
              className="min-h-24"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="要完成什么、交付什么格式、有哪些约束"
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">源工作区</span>
            <div className="flex gap-2">
              <Input
                className="font-mono text-xs"
                value={workspace}
                onChange={(event) => setWorkspace(event.target.value)}
                placeholder="绝对路径，例如 D:\\项目\\资料"
              />
              <Button variant="outline" size="sm" type="button" onClick={() => void chooseFolder()}>
                <FolderOpen className="size-3.5" aria-hidden />
                选择
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">
              {projectTitle ? '必须位于项目的工作区根内；任务只能读取这里。' : '任务只能读取这里；不能直接改源文件。'}
            </p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">权限</span>
            <select
              value={permission}
              onChange={(event) => setPermission(event.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {MODE_ORDER.map((mode) => (
                <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border border-border bg-panel/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {effectivePolicy === 'local_only' ? <HardDrive className="size-4" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
                模型路由与数据边界
              </div>
              <span className={effectivePolicy === 'local_only'
                ? 'rounded-full border border-success/30 bg-success/10 px-2 py-1.5 text-micro text-success'
                : 'rounded-full border border-border bg-card px-2 py-1.5 text-micro text-muted-foreground'}>
                {effectivePolicy === 'local_only' ? '仅本地 · 0 次云端请求' : '允许云端'}
              </span>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              {PROFILE_OPTIONS.map((option) => {
                const disabled = effectivePolicy === 'local_only' && option.value !== 'private'
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={disabled}
                    aria-pressed={effectiveProfile === option.value}
                    onClick={() => setProfile(option.value)}
                    className={effectiveProfile === option.value
                      ? 'rounded-md border border-primary/40 bg-primary/5 px-2.5 py-2 text-left'
                      : 'rounded-md border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-45'}
                  >
                    <span className="block text-sm font-medium text-foreground">{option.label}</span>
                    <span className="mt-0.5 block text-caption leading-relaxed text-muted-foreground">{option.detail}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-caption text-muted-foreground" aria-live="polite">
              {routeLoading
                ? '正在检查可用模型…'
                : routeError
                  ? `预检失败：${routeError}`
                  : route
                    ? `${route.provider_label} · ${route.model} · ${routeCostText(route)}。${route.reason}`
                    : '还没有可用的模型渠道；创建后需要先配置模型。'}
            </p>
            {route?.fallback && (
              <p className="mt-1 text-caption text-muted-foreground">已回退：{route.fallback.from_model} → {route.model}（{route.fallback.reason}）</p>
            )}
            {effectivePolicy === 'cloud' && (
              <label className="mt-2.5 flex items-start gap-2 border-t border-border pt-2.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 rounded border-border"
                  checked={cloudConsent}
                  onChange={(event) => setCloudConsent(event.target.checked)}
                />
                我确认这个任务的资料可能发送到云端模型；本机可用时不会发送。
              </label>
            )}
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            disabled={busy || !title.trim() || !objective.trim() || !workspace.trim() || (effectivePolicy === 'cloud' && !cloudConsent)}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            创建任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
