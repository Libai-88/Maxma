/**
 * CommandPane — 工作区命令运行器（P2，无 TTY，不是终端）。
 *
 * 每次运行一次性进程，cwd 由后端锁到工作区根；默认关闭，用户显式启用并
 * 自己点“运行”。不做交互式 shell，也不保存命令历史到服务端。
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, CircleAlert, Play, RefreshCw, SquareTerminal } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CommandResult, WorkspaceRoot } from '@/types/workspace'

const ENABLED_KEY = 'maxmahere.command-runner.enabled'

export function CommandPane() {
  const [roots, setRoots] = useState<WorkspaceRoot[]>([])
  const [rootId, setRootId] = useState('')
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(ENABLED_KEY) === '1' } catch { return false }
  })
  const [command, setCommand] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(60000)
  const [result, setResult] = useState<CommandResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [loadingRoots, setLoadingRoots] = useState(true)

  const activeRoot = useMemo(() => roots.find((root) => root.id === rootId) ?? roots[0] ?? null, [rootId, roots])

  useEffect(() => {
    let alive = true
    void api.listWorkspaceRoots().then((response) => {
      if (!alive) return
      setRoots(response.roots)
      setRootId((current) => response.roots.some((root) => root.id === current) ? current : response.roots[0]?.id ?? '')
    }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoadingRoots(false) })
    return () => { alive = false }
  }, [])

  function toggleEnabled() {
    if (!enabled && !window.confirm('命令以当前系统账号执行，可读写工作区并能访问网络。它不是沙箱；确定启用？')) return
    const next = !enabled
    setEnabled(next)
    try { localStorage.setItem(ENABLED_KEY, next ? '1' : '0') } catch { /* ignore */ }
  }

  async function run() {
    if (!activeRoot || !command.trim() || running) return
    setRunning(true)
    setError('')
    setResult(null)
    try {
      setResult(await api.workspaceRun(activeRoot.id, command.trim(), timeoutMs))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  if (loadingRoots) return <div className="flex flex-1 items-center justify-center text-caption text-muted-foreground">加载工作区…</div>

  if (!activeRoot) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <SquareTerminal className="size-7 text-muted-foreground" />
        <p className="text-caption text-foreground">还没有工作区</p>
        <p className="text-micro text-muted-foreground">先在“文件”标签页授权一个文件夹。</p>
      </div>
    )
  }

  if (!enabled) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-6 text-center">
        <CircleAlert className="size-7 text-muted-foreground" />
        <div>
          <p className="text-caption text-foreground">命令运行器默认关闭</p>
          <p className="mt-1 text-micro text-muted-foreground">它不是终端：每次只运行一条命令，cwd 固定在工作区根，超时会杀进程树。命令以你的系统账号权限执行，没有沙箱。</p>
        </div>
        {error && <p className="text-micro text-destructive">{error}</p>}
        <Button size="sm" onClick={toggleEnabled}><Play className="mr-1 size-3.5" />启用命令运行器</Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <select
            aria-label="命令运行器工作区"
            value={activeRoot.id}
            onChange={(event) => setRootId(event.target.value)}
            className="h-7 w-full appearance-none truncate rounded-md border border-border bg-card/50 pl-2 pr-7 text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {roots.map((root) => <option key={root.id} value={root.id}>{root.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1.5 size-3.5 text-muted-foreground" />
        </div>
        <Button size="xs" variant="ghost" onClick={toggleEnabled} aria-label="关闭命令运行器">关闭</Button>
      </div>
      <p className="truncate px-1 text-micro text-muted-foreground" title={activeRoot.path}>{activeRoot.path}</p>

      <div className="flex items-center gap-1">
        <Input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="输入一条命令，例如 git status"
          className="h-8 min-w-0 flex-1 font-mono text-caption"
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void run() }}
          aria-label="命令"
        />
        <select
          aria-label="超时"
          value={timeoutMs}
          onChange={(event) => setTimeoutMs(Number(event.target.value))}
          className="h-8 shrink-0 rounded-md border border-border bg-card/50 px-2 text-micro text-muted-foreground"
        >
          <option value={30000}>30s</option>
          <option value={60000}>60s</option>
          <option value={120000}>120s</option>
        </select>
        <Button size="icon-sm" aria-label="运行命令" title="运行" disabled={!command.trim() || running} onClick={() => void run()}>
          <Play className={cn('size-3.5', running && 'animate-pulse')} />
        </Button>
      </div>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-caption text-destructive">{error}</p>}

      {result && (
        <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card/40">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5 text-micro text-muted-foreground">
            <span className={cn('font-mono', result.exitCode === 0 ? 'text-foreground' : 'text-destructive')}>
              exit {result.exitCode ?? result.signal ?? '?'}
            </span>
            <span>{result.durationMs} ms</span>
            {result.timedOut && <span className="text-destructive">超时，已杀进程树</span>}
            {result.truncated && <span className="text-destructive">输出截断</span>}
            <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setResult(null)}><RefreshCw className="mr-1 size-3" />清空</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-2 font-mono text-caption leading-5">
            {result.stdout && <pre className="whitespace-pre-wrap text-foreground">{result.stdout}</pre>}
            {result.stderr && <pre className="mt-2 whitespace-pre-wrap text-destructive">{result.stderr}</pre>}
            {!result.stdout && !result.stderr && <p className="text-muted-foreground">（无输出）</p>}
          </div>
        </div>
      )}

      {!result && !error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <SquareTerminal className="size-6 text-muted-foreground" />
          <p className="text-caption text-muted-foreground">一次性运行，不保留交互会话。</p>
          <p className="text-micro text-muted-foreground">超时上限 120 秒；工作区根之外不可作为 cwd。</p>
        </div>
      )}
    </div>
  )
}
