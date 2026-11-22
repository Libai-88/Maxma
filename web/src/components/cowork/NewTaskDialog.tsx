import { useEffect, useState } from 'react'
import { FolderOpen, Loader2, Plus } from 'lucide-react'

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

export function NewTaskDialog({ open, onOpenChange, projectId, projectTitle, projectRoots = [] }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  projectTitle?: string
  projectRoots?: string[]
}) {
  const createTask = useCoworkStore((state) => state.createTask)
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [permission, setPermission] = useState('operate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || workspace) return
    const first = projectRoots[0]
    if (first) setWorkspace(first)
  }, [open, projectRoots, workspace])

  function reset(): void {
    setTitle('')
    setObjective('')
    setWorkspace('')
    setPermission('operate')
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
    setBusy(true)
    setError('')
    try {
      await createTask({
        title: title.trim(),
        objective: objective.trim(),
        workspace_root: workspace.trim(),
        permission_mode: permission,
        project_id: projectId,
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription>
            {projectTitle
              ? `任务会归入「${projectTitle}」，并使用项目的指令、默认模板和资产。`
              : '源工作区只读；产物写入任务自己的 staging 目录，验收后才算交付。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
            <p className="text-caption text-muted-foreground">
              写入只落在任务 staging；源工作区始终只读。
            </p>
          </label>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={busy || !title.trim() || !objective.trim() || !workspace.trim()} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            创建任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
