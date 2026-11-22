/**
 * CoworkArtifactStudio — 产物只读预览 + 结构化选改。
 *
 * 预览复用工作台的 OfficePreview；选区只作为“改哪一处”的上下文，
 * 不会在浏览器里直接改文件。提交后由 Agent 走一轮计划审批，
 * 用 edit_office_file 精确修改并生成新版本。
 */

import { Loader2, MousePointer2, Send, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { OfficePreview, type OfficeFormat, type OfficeSelection } from '@/components/workbench/OfficePreview'
import { useCoworkStore } from '@/stores/cowork'
import type { CoworkArtifact } from '@/types/cowork'
import { baseName } from './taskUi'

function extensionOf(name: string): OfficeFormat | null {
  const extension = name.split('.').pop()?.toLowerCase()
  return extension === 'docx' || extension === 'xlsx' || extension === 'pptx' ? extension : null
}

function selectionLabel(selection: OfficeSelection | null): string {
  if (!selection) return '还没有选区'
  if (selection.cell) return `${selection.sheet ?? '工作表'} · ${selection.cell}`
  if (selection.slide) return `第 ${selection.slide} 页 · ${selection.text.length} 字`
  return `选中 ${selection.text.length} 字`
}

export function CoworkArtifactStudio({ taskId, artifact, onClose }: {
  taskId: string
  artifact: CoworkArtifact
  onClose: () => void
}) {
  const reviseTask = useCoworkStore((state) => state.reviseTask)
  const action = useCoworkStore((state) => state.action)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<OfficeSelection | null>(null)
  const [instruction, setInstruction] = useState('')
  const format = useMemo(() => extensionOf(artifact.path), [artifact.path])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setBlob(null)
    void (async () => {
      try {
        const url = await api.prepareCoworkArtifact(taskId, artifact.id, true)
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) throw new Error(`预览读取失败：HTTP ${response.status}`)
        const data = await response.blob()
        if (!cancelled) setBlob(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [taskId, artifact.id])

  const busy = action === 'revise'
  const canSubmit = Boolean(selection?.text || (selection?.sheet && selection.cell)) && instruction.trim().length > 0 && !busy

  async function submit(): Promise<void> {
    if (!selection || !canSubmit) return
    await reviseTask({
      artifact_id: artifact.id,
      instruction: instruction.trim(),
      selection: {
        kind: artifact.kind,
        text: selection.text,
        ...(selection.slide ? { slide: selection.slide } : {}),
        ...(selection.sheet ? { sheet: selection.sheet } : {}),
        ...(selection.cell ? { cell: selection.cell } : {}),
      },
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex h-[86vh] w-[min(1120px,calc(100vw-2rem))] max-w-none flex-col gap-3 p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            {baseName(artifact.path)}
            <span className="text-caption font-normal text-muted-foreground">v{artifact.version}</span>
          </DialogTitle>
          <DialogDescription>
            只读预览。选中一段文字或点一个单元格，写下要改什么；提交后 Agent 先给计划，批准后才写入，旧版本会保留。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-5 pb-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card/30 p-3">
            {loading && <div className="flex flex-1 items-center justify-center gap-2 text-caption text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在读取产物预览…</div>}
            {error && <div className="flex flex-1 items-center justify-center p-4 text-caption text-destructive">{error}</div>}
            {!loading && !error && blob && format && (
              <OfficePreview format={format} blob={blob} name={baseName(artifact.path)} onSelection={setSelection} />
            )}
            {!loading && !error && (!format || !blob) && (
              <div className="flex flex-1 items-center justify-center text-caption text-muted-foreground">这个产物类型暂不支持可视化选改。</div>
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            <div className="rounded-lg border border-border bg-card/40 p-3">
              <p className="flex items-center gap-1.5 text-caption font-medium text-foreground">
                <MousePointer2 className="size-3.5 text-primary" aria-hidden />
                当前选区
              </p>
              <p className="mt-1.5 text-caption text-muted-foreground">{selectionLabel(selection)}</p>
              {selection?.text && (
                <blockquote className="mt-2 max-h-28 overflow-auto rounded-md border-l-2 border-primary/50 bg-muted/40 px-2.5 py-2 text-caption text-foreground">
                  {selection.text}
                </blockquote>
              )}
              {format === 'xlsx' && <p className="mt-2 text-caption text-muted-foreground">点表格里的已有单元格来选改；新值由下方指令说明。</p>}
            </div>

            <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-caption text-muted-foreground">
              修改要求
              <Textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder={format === 'xlsx'
                  ? '例如：把这个单元格改成 128，并保持表头和其他行不变'
                  : '例如：把这段改成更简洁的结论，保留原来的标题和其余段落'}
                className="min-h-28 flex-1 resize-none"
                maxLength={20_000}
              />
            </label>

            <div className="rounded-md bg-muted/45 px-3 py-2 text-caption text-muted-foreground">
              选改只替换选区，不重写整份文件；DOCX/PPTX 会保留其余段落、版式和项目符号。选区在当前版本中必须唯一，否则 Agent 会要求收窄选区。
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
            发起选改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
