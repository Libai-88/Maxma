/**
 * M4 跨任务审批中心。
 *
 * 只呈现后端 `cowwork_approvals` 的事实：批量能力也由后端 `batchable` 决定，
 * 前端不自行推断“低风险”。计划仍回任务详情审阅，避免在这里丢失计划正文。
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, ClipboardList, Download, Loader2, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { COWORK_APPROVAL_LABELS, useCoworkStore } from '@/stores/cowork'
import type { CoworkApprovalView } from '@/types/cowork'

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'export') return <Download className="size-4 text-muted-foreground" aria-hidden />
  if (kind === 'delete') return <Trash2 className="size-4 text-muted-foreground" aria-hidden />
  if (kind === 'plan') return <ClipboardList className="size-4 text-muted-foreground" aria-hidden />
  return <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
}

export function CoworkApprovalCenter({ open, onOpenChange, onOpenTask }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenTask: (taskId: string) => void
}) {
  const approvals = useCoworkStore((state) => state.approvals)
  const loading = useCoworkStore((state) => state.approvalsLoading)
  const action = useCoworkStore((state) => state.action)
  const fetchApprovals = useCoworkStore((state) => state.fetchApprovals)
  const batchApprove = useCoworkStore((state) => state.batchApprove)
  const decideApproval = useCoworkStore((state) => state.decideApproval)
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    setNote('')
    setSelected([])
    void fetchApprovals('pending')
    const timer = setInterval(() => { void fetchApprovals('pending') }, 5000)
    return () => clearInterval(timer)
  }, [open, fetchApprovals])

  const batchable = useMemo(() => approvals.filter((item) => item.batchable), [approvals])
  const selectedSafe = selected.filter((id) => batchable.some((item) => item.id === id))
  const busy = Boolean(action)

  function toggle(id: string): void {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function approve(approval: CoworkApprovalView): Promise<void> {
    setNote('')
    await decideApproval(approval.id, 'approve')
    setNote(`已处理：${approval.title}`)
  }

  async function batch(): Promise<void> {
    if (selectedSafe.length === 0) return
    setNote('')
    await batchApprove(selectedSafe)
    setSelected([])
    setNote(`已批量批准 ${selectedSafe.length} 个低风险只读操作。`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            审批中心
            {approvals.length > 0 && (
              <span className="rounded-full border border-border bg-panel px-2 py-1.5 text-micro font-normal text-muted-foreground">
                {approvals.length} 项待处理
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            跨任务查看所有待批准操作。只有低风险只读工具可以批量批准；计划、写入、导出和删除必须逐项确认。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-caption text-muted-foreground">
            {batchable.length > 0 ? `${batchable.length} 项可批量批准` : '当前没有可批量批准的安全项'}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={loading || busy} onClick={() => void fetchApprovals('pending')}>
              {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
              刷新
            </Button>
            <Button size="sm" disabled={busy || selectedSafe.length === 0} onClick={() => void batch()}>
              <Check className="size-3.5" aria-hidden />
              批准选中（{selectedSafe.length}）
            </Button>
          </div>
        </div>

        {note && (
          <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{note}</p>
        )}

        <div className="max-h-[55vh] space-y-2 overflow-y-auto scrollbar-thin pr-1">
          {approvals.length === 0 && !loading ? (
            <div className="rounded-lg border border-border bg-panel/40 px-4 py-8 text-center">
              <ClipboardList className="mx-auto size-5 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm text-foreground">没有待批准的操作</p>
              <p className="mt-1 text-caption text-muted-foreground">任务需要你确认时会出现在这里。</p>
            </div>
          ) : (
            approvals.map((approval) => (
              <article key={approval.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  {approval.batchable ? (
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 rounded border-border"
                      aria-label={`选择 ${approval.title}`}
                      checked={selected.includes(approval.id)}
                      onChange={() => toggle(approval.id)}
                    />
                  ) : (
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-panel">
                      <KindIcon kind={approval.kind} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-border bg-panel px-2 py-1.5 text-micro text-muted-foreground">
                        {COWORK_APPROVAL_LABELS[approval.kind] ?? approval.kind}
                      </span>
                      {approval.batchable && (
                        <span className="rounded-full border border-success/30 bg-success/10 px-2 py-1.5 text-micro text-success">可批量</span>
                      )}
                      <span className="text-caption text-muted-foreground">{approval.task_title}</span>
                    </div>
                    <h3 className="mt-1.5 text-sm font-semibold text-foreground">{approval.title}</h3>
                    {approval.detail && (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-caption leading-relaxed text-muted-foreground">
                        {approval.detail}
                      </p>
                    )}
                    <p className="mt-1 text-caption text-muted-foreground">
                      风险 {approval.risk_level}
                      {approval.expires_at && <> · {new Date(approval.expires_at).toLocaleString('zh-CN')} 前有效</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {approval.kind === 'plan' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { onOpenChange(false); onOpenTask(approval.task_id) }}
                      >
                        审阅计划
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => void approve(approval)}>
                          <Check className="size-3.5" aria-hidden />
                          允许
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => { void decideApproval(approval.id, 'reject') }}
                        >
                          <X className="size-3.5" aria-hidden />
                          拒绝
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
