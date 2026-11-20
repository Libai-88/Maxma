/**
 * ChangesPane — 工作区 Git 只读变更审阅（P2）。
 *
 * status/diff 都从后端 /api/git/* 获取；不在这里执行任何 git 命令。
 * P3 的 stage/commit 会在此面板上增加显式审批，不会自动 push。
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FileDiff, RefreshCw } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { GitDiffResult, GitFileStatus, GitStatusResult, WorkspaceRoot } from '@/types/workspace'

function statusLabel(file: GitFileStatus): string {
  if (file.untracked) return '未跟踪'
  if (file.renamed) return '重命名'
  if (file.deleted) return '删除'
  if (file.index !== ' ' && file.worktree !== ' ') return `${file.index}${file.worktree}`
  return file.index !== ' ' ? `暂存 ${file.index}` : `工作区 ${file.worktree}`
}

function PatchView({ diff }: { diff: GitDiffResult }) {
  if (diff.untracked) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-caption text-muted-foreground">
        <FileDiff className="size-6" />
        <p>未跟踪文件，Git 还没有 diff。</p>
        <p className="text-micro">可在“文件”标签页打开，或暂存后查看新增内容。</p>
      </div>
    )
  }
  if (!diff.patch.trim()) {
    return <div className="flex flex-1 items-center justify-center p-6 text-caption text-muted-foreground">这个范围没有差异。</div>
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-thin rounded-md border border-border bg-card/40">
      <pre className="min-w-max py-2 font-mono text-caption leading-5">
        {diff.patch.split('\n').map((line, index) => (
          <div
            key={index}
            className={cn(
              'whitespace-pre px-3',
              line.startsWith('+') && !line.startsWith('+++') && 'bg-primary/10 text-foreground',
              line.startsWith('-') && !line.startsWith('---') && 'bg-destructive/10 text-destructive',
              line.startsWith('@@') && 'text-muted-foreground',
              (line.startsWith('+++') || line.startsWith('---')) && 'text-foreground',
            )}
          >
            {line || ' '}
          </div>
        ))}
      </pre>
      {diff.truncated && <p className="border-t border-border px-3 py-2 text-caption text-muted-foreground">diff 过大，仅显示前 400 KiB。</p>}
    </div>
  )
}

export function ChangesPane() {
  const [roots, setRoots] = useState<WorkspaceRoot[]>([])
  const [rootId, setRootId] = useState('')
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [selected, setSelected] = useState<GitFileStatus | null>(null)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const activeRoot = useMemo(() => roots.find((root) => root.id === rootId) ?? roots[0] ?? null, [rootId, roots])

  useEffect(() => {
    let alive = true
    void api.listWorkspaceRoots().then((result) => {
      if (!alive) return
      const sorted = [...result.roots].sort((a, b) => Number(b.available !== false) - Number(a.available !== false) || b.last_used_at - a.last_used_at)
      setRoots(sorted)
      setRootId((current) => sorted.some((root) => root.id === current) ? current : sorted[0]?.id ?? '')
    }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!activeRoot) return
    let alive = true
    setLoading(true)
    setError('')
    void api.gitStatus(activeRoot.id).then((result) => {
      if (!alive) return
      setStatus(result)
      setSelected(null)
      setDiff(null)
    }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeRoot, refreshToken])

  async function openDiff(file: GitFileStatus, staged: boolean) {
    if (!activeRoot) return
    setSelected(file)
    setDiffLoading(true)
    setError('')
    try {
      setDiff(await api.gitDiff(activeRoot.id, file.path, staged))
    } catch (e) {
      setDiff(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDiffLoading(false)
    }
  }

  async function stage(paths: string[]) {
    if (!activeRoot || paths.length === 0) return
    if (!window.confirm(`暂存 ${paths.length} 个文件到 Git 索引？不会提交或推送。`)) return
    setBusy(true)
    setError('')
    try {
      setStatus(await api.gitStage(activeRoot.id, paths))
      setNotice('已暂存到索引')
      setSelected(null)
      setDiff(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function unstage(paths: string[]) {
    if (!activeRoot || paths.length === 0) return
    if (!window.confirm(`从索引取消暂存 ${paths.length} 个文件？工作区内容不会丢失。`)) return
    setBusy(true)
    setError('')
    try {
      setStatus(await api.gitUnstage(activeRoot.id, paths))
      setNotice('已取消暂存')
      setSelected(null)
      setDiff(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!activeRoot || !status) return
    const stagedCount = status.files.filter((file) => file.staged).length
    if (stagedCount === 0) { setError('暂存区为空，没有可提交的变更。'); return }
    if (!commitMessage.trim()) { setError('请填写提交信息'); return }
    if (!window.confirm(`提交 ${stagedCount} 个已暂存文件？只创建本地 commit，不会 push。`)) return
    setBusy(true)
    setError('')
    try {
      const result = await api.gitCommit(activeRoot.id, commitMessage.trim())
      setCommitMessage('')
      setStatus(await api.gitStatus(activeRoot.id))
      setNotice(`已提交 ${result.commit ?? ''}（未推送）`)
      setSelected(null)
      setDiff(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!activeRoot) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <FileDiff className="size-7 text-muted-foreground" />
        <p className="text-caption text-foreground">还没有工作区</p>
        <p className="text-micro text-muted-foreground">先在“文件”标签页选择授权文件夹，再回来查看 Git 变更。</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <select
            aria-label="变更面板工作区"
            value={activeRoot.id}
            onChange={(event) => setRootId(event.target.value)}
            className="h-7 w-full appearance-none truncate rounded-md border border-border bg-card/50 pl-2 pr-7 text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {roots.map((root) => <option key={root.id} value={root.id}>{root.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1.5 size-3.5 text-muted-foreground" />
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="刷新 Git 状态" title="刷新" onClick={() => setRefreshToken((value) => value + 1)}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {loading && <p className="px-1 text-caption text-muted-foreground">读取 Git 状态…</p>}
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-caption text-destructive">{error}</p>}
      {notice && <p className="rounded-md border border-border bg-accent/40 px-2 py-1.5 text-caption text-muted-foreground">{notice}</p>}

      {!loading && status && !status.isRepo && (
        <p className="px-1 py-4 text-center text-caption text-muted-foreground">这个工作区不是 Git 仓库。</p>
      )}

      {status?.isRepo && (
        <>
          <div className="flex flex-wrap items-center gap-2 px-1 text-caption text-muted-foreground">
            <span className="rounded-md bg-accent/50 px-1.5 py-0.5 text-foreground">{status.detached ? 'detached' : status.branch ?? '未知分支'}</span>
            {status.head && <span className="font-mono text-micro">{status.head}</span>}
            <span>{status.files.length} 个变更</span>
            {status.files.length > 0 && (
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => void stage(status.files.map((file) => file.path))}>全部暂存</Button>
            )}
          </div>
          {status.truncated && <p className="px-1 text-micro text-muted-foreground">变更过多，仅显示前 500 项。</p>}

          <div className="max-h-[30%] min-h-24 overflow-y-auto scrollbar-thin rounded-md border border-border bg-card/30">
            {status.files.length === 0 && <p className="px-3 py-4 text-center text-caption text-muted-foreground">工作区是干净的。</p>}
            {status.files.map((file) => (
              <div key={`${file.path}-${file.oldPath ?? ''}`} className="border-b border-border/60 last:border-b-0">
                <button
                  type="button"
                  className={cn('flex w-full items-center gap-2 px-2 py-1.5 text-left text-caption hover:bg-accent/30', selected?.path === file.path && 'bg-accent/40')}
                  onClick={() => void openDiff(file, file.staged && !file.untracked)}
                >
                  <span className="w-14 shrink-0 truncate text-micro text-muted-foreground">{statusLabel(file)}</span>
                  <span className="min-w-0 flex-1 truncate" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
                    {file.path}
                    {file.oldPath && <span className="text-muted-foreground"> ← {file.oldPath}</span>}
                  </span>
                </button>
                <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                  {file.staged ? (
                    <Button variant="ghost" size="xs" disabled={busy} onClick={() => void unstage([file.path])}>取消暂存</Button>
                  ) : (
                    <Button variant="ghost" size="xs" disabled={busy} onClick={() => void stage([file.path])}>暂存</Button>
                  )}
                  {file.staged && file.worktree !== ' ' && (
                    <>
                      <Button variant="ghost" size="xs" onClick={() => void openDiff(file, true)}>暂存 diff</Button>
                      <Button variant="ghost" size="xs" onClick={() => void openDiff(file, false)}>工作区 diff</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1">
            {selected && (
              <div className="flex items-center justify-between gap-2 px-1 text-micro text-muted-foreground">
                <span className="truncate">{selected.path}</span>
                {diffLoading && <span>读取 diff…</span>}
              </div>
            )}
            {diff ? <PatchView diff={diff} /> : <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border p-4 text-caption text-muted-foreground">选一个变更查看 diff。</div>}
          </div>

          <div className="flex flex-col gap-1 rounded-md border border-border bg-card/40 p-2">
            <div className="flex items-center justify-between text-micro text-muted-foreground">
              <span>本地提交（不 push）</span>
              <span>{status.files.filter((file) => file.staged).length} 个已暂存</span>
            </div>
            <div className="flex items-center gap-1">
              <Input
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="提交信息"
                className="h-7 min-w-0 flex-1 text-caption"
                maxLength={5000}
                aria-label="提交信息"
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void commit() }}
              />
              <Button size="xs" disabled={busy || !commitMessage.trim() || status.files.every((file) => !file.staged)} onClick={() => void commit()}>提交</Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
