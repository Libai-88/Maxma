import { useState } from 'react'
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

export function NewProjectDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (projectId: string) => void
}) {
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [root, setRoot] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function reset(): void {
    setTitle('')
    setInstructions('')
    setRoot('')
    setBusy(false)
    setError('')
  }

  async function chooseFolder(): Promise<void> {
    setError('')
    try {
      const { path } = await api.selectFolder()
      if (path) setRoot(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function submit(): Promise<void> {
    if (!title.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const { project } = await api.createCoworkProject({
        title: title.trim(),
        instructions: instructions.trim(),
        workspace_roots: root.trim() ? [root.trim()] : [],
      })
      reset()
      onOpenChange(false)
      onCreated(project.id)
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
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            项目只存工作区引用、指令和资产索引；源文件仍留在你的工作区。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">项目名称</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} autoFocus placeholder="例如：热电材料周报" />
          </label>
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">工作区根（可选）</span>
            <div className="flex gap-2">
              <Input
                className="font-mono text-xs"
                value={root}
                onChange={(event) => setRoot(event.target.value)}
                placeholder="绝对路径，例如 D:\\项目\\资料"
              />
              <Button variant="outline" size="sm" type="button" onClick={() => void chooseFolder()}>
                <FolderOpen className="size-3.5" aria-hidden />
                选择
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">项目任务的源工作区必须落在这个根内。</p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">项目指令（可选）</span>
            <Textarea
              className="min-h-24"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="例如：引用文献必须给出页码；结论必须附样品编号。"
            />
          </label>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={busy || !title.trim()} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            创建项目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
