import { useEffect, useState } from 'react'
import { Check, Copy, Download, FileCheck2, Fingerprint, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'

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
import { verifyPassport } from '@/lib/passport'
import type { CoworkTaskPassportBundle } from '@/types/cowork'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function routeText(bundle: CoworkTaskPassportBundle | null): string {
  const route = bundle?.passport.route
  if (!route) return '待运行'
  const location = route.location === 'local' ? '本机' : route.location === 'cloud' ? '云端' : route.location || '未知'
  return `${location} · ${route.provider_label || route.provider_id || '模型'}`
}

function downloadText(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function PassportStat({ label, value, detail, wrap = false }: { label: string; value: string; detail?: string; wrap?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-panel/40 px-3 py-2">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-mono text-xs text-foreground ${wrap ? 'break-words' : 'truncate'}`} title={value}>{value}</dd>
      {detail && <dd className="mt-0.5 break-words text-caption text-muted-foreground" title={detail}>{detail}</dd>}
    </div>
  )
}

export function TaskPassportCard({
  taskId,
  status,
  artifactCount,
  updatedAt,
}: {
  taskId: string
  status: string
  artifactCount: number
  updatedAt: string
}) {
  const [bundle, setBundle] = useState<CoworkTaskPassportBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [noteOk, setNoteOk] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setBundle(null)
    api.getCoworkTaskPassport(taskId)
      .then((next) => {
        if (cancelled) return
        setBundle(next)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [artifactCount, status, taskId, updatedAt])

  function retry(): void {
    setLoading(true)
    setError('')
    api.getCoworkTaskPassport(taskId)
      .then((next) => {
        setBundle(next)
        setError('')
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }

  async function copyDigest(): Promise<void> {
    if (!bundle) return
    try {
      await navigator.clipboard.writeText(bundle.passport.integrity.digest)
      setNoteOk(true)
      setNote('护照指纹已复制')
    } catch {
      setNoteOk(false)
      setNote('复制失败，请打开详情手动选择指纹')
    }
  }

  if (loading) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground" aria-label="Maxma 任务护照">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        正在生成任务护照
      </section>
    )
  }

  if (error || !bundle) {
    return (
      <section className="rounded-lg border border-border bg-card p-4" aria-label="Maxma 任务护照">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Fingerprint className="size-4" aria-hidden />
            任务护照暂不可用
          </div>
          <Button size="sm" variant="outline" onClick={retry}>
            <RefreshCw className="size-3.5" aria-hidden />
            重试
          </Button>
        </div>
        {error && <p className="mt-2 break-words text-caption text-destructive">{error}</p>}
      </section>
    )
  }

  const { passport, markdown, filenames } = bundle
  const localOnly = passport.task.data_policy === 'local_only'
  const route = routeText(bundle)
  const approvalText = `${passport.approvals.approved}/${passport.approvals.total}`
  const digestShort = passport.integrity.digest.slice(0, 12)

  async function verify(): Promise<void> {
    setChecking(true)
    setNote('')
    try {
      const result = await verifyPassport(passport)
      if (result.matches && result.passportIdMatches) {
        setNoteOk(true)
        setNote('本地核验通过：指纹与护照正文一致，编号匹配')
      } else {
        setNoteOk(false)
        setNote('核验未通过：护照正文或指纹已被改动')
      }
    } catch {
      setNoteOk(false)
      setNote('本地核验失败：浏览器加密能力不可用')
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      {/* 窄窗口只保留可点的护照摘要，完整护照在弹窗中查看，避免 318px 卡片被任务面板裁切。 */}
      <button
        type="button"
        className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors duration-fast ease-standard hover:bg-accent/20 xl:hidden"
        aria-label="打开 Maxma 任务护照"
        onClick={() => setOpen(true)}
      >
        <div className="relative grid size-9 shrink-0 place-items-center rounded-full border border-success/40 bg-success/5 font-mono text-xs font-semibold text-success" aria-hidden>
          M
          <span className="absolute inset-1 rounded-full border border-success/20" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Maxma / Passport</p>
            <span className={localOnly
              ? 'inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-caption text-success'
              : 'inline-flex items-center gap-1 rounded-full border border-border bg-panel px-2 py-0.5 text-caption text-muted-foreground'}
            >
              <ShieldCheck className="size-3" aria-hidden />
              {localOnly ? 'LOCAL-ONLY' : 'CLOUD-ALLOWED'}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">任务护照 · {digestShort}</p>
          <p className="mt-0.5 truncate text-caption text-muted-foreground">{route} · 审批 {approvalText} · {passport.artifacts.count} 件交付物</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-caption text-primary group-hover:text-foreground">
          查看
          <FileCheck2 className="size-3.5" aria-hidden />
        </span>
      </button>

      <section className="hidden rounded-lg border border-border bg-card p-4 xl:block" aria-label="Maxma 任务护照">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="relative grid size-11 shrink-0 place-items-center rounded-full border border-success/40 bg-success/5 font-mono text-sm font-semibold text-success" aria-hidden>
              M
              <span className="absolute inset-1 rounded-full border border-success/20" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Maxma / Passport</p>
                <span className={localOnly
                  ? 'inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-1 text-caption text-success'
                  : 'inline-flex items-center gap-1 rounded-full border border-border bg-panel px-2 py-1 text-caption text-muted-foreground'}
                >
                  <ShieldCheck className="size-3" aria-hidden />
                  {localOnly ? 'LOCAL-ONLY' : 'CLOUD-ALLOWED'}
                </span>
              </div>
              <h2 className="mt-1 text-sm font-semibold tracking-tight text-foreground">每个交付，都有一张护照</h2>
              <p className="mt-1 text-caption leading-relaxed text-muted-foreground">模型路由、审批、产物 SHA-256 与数据边界，收在一张本地凭证里。</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <FileCheck2 className="size-3.5" aria-hidden />
              查看护照
            </Button>
            <Button size="sm" variant="ghost" onClick={() => downloadText(JSON.stringify(passport, null, 2), filenames.json, 'application/json')}>
              <Download className="size-3.5" aria-hidden />
              JSON
            </Button>
          </div>
        </div>
        <dl className="mt-3 grid gap-2 border-t border-border pt-3 grid-cols-2 lg:grid-cols-4">
          <PassportStat label="模型路由" value={route} detail={passport.route?.reason || undefined} wrap />
          <PassportStat label="审批" value={approvalText} detail={`${passport.approvals.pending} 待处理`} />
          <PassportStat label="交付物" value={`${passport.artifacts.count} 件`} detail={formatBytes(passport.artifacts.total_bytes)} />
          <PassportStat label="护照指纹" value={digestShort} detail={passport.passport_id} />
        </dl>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fingerprint className="size-4 text-success" aria-hidden />
              Maxma 任务护照
            </DialogTitle>
            <DialogDescription>
              {passport.passport_id} · 签发于 {new Date(passport.issued_at).toLocaleString('zh-CN')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md border border-border bg-panel/40 px-3 py-2">
              <p className="text-caption text-muted-foreground">模型路由</p>
              <p className="mt-0.5 truncate font-mono text-xs" title={route}>{route}</p>
            </div>
            <div className="rounded-md border border-border bg-panel/40 px-3 py-2">
              <p className="text-caption text-muted-foreground">审批</p>
              <p className="mt-0.5 font-mono text-xs">{approvalText}</p>
            </div>
            <div className="rounded-md border border-border bg-panel/40 px-3 py-2">
              <p className="text-caption text-muted-foreground">交付物</p>
              <p className="mt-0.5 font-mono text-xs">{passport.artifacts.count} 件 · {formatBytes(passport.artifacts.total_bytes)}</p>
            </div>
            <div className="rounded-md border border-border bg-panel/40 px-3 py-2">
              <p className="text-caption text-muted-foreground">数据策略</p>
              <p className="mt-0.5 font-mono text-xs">{passport.task.data_policy}</p>
            </div>
          </div>
          <div className="max-h-[46vh] overflow-auto rounded-md border border-border bg-panel/40 p-3">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">{markdown}</pre>
          </div>
          {note && <p role="status" aria-live="polite" className={`flex items-center gap-1.5 text-caption ${noteOk ? 'text-success' : 'text-destructive'}`}>{noteOk && <Check className="size-3.5" aria-hidden />}{note}</p>}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => void copyDigest()}>
                <Copy className="size-3.5" aria-hidden />
                复制指纹
              </Button>
              <Button variant="ghost" onClick={() => void verify()} disabled={checking}>
                {checking ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="size-3.5" aria-hidden />}
                {checking ? '核验中' : '核验指纹'}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => downloadText(markdown, filenames.markdown, 'text/markdown')}>
                <Download className="size-3.5" aria-hidden />
                Markdown
              </Button>
              <Button onClick={() => downloadText(JSON.stringify(passport, null, 2), filenames.json, 'application/json')}>
                <Download className="size-3.5" aria-hidden />
                JSON
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
