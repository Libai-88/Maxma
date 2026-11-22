import { useEffect, useState } from 'react'
import { Bell, BellOff, FolderOpen, Link2, Loader2, Search, X } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { SectionCard } from '@/components/cowork/taskUi'
import { notifyEnabled, setNotifyEnabled } from '@/utils/coworkNotify'
import type {
  CoworkConnectorList,
  CoworkMemoryFact,
  CoworkProject,
} from '@/types/cowork'

function parseList(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function ConnectorsList({ list }: { list: CoworkConnectorList | null }) {
  if (!list) return <p className="px-4 py-5 text-sm text-muted-foreground">正在读取连接器…</p>
  return (
    <div className="space-y-3 p-4">
      <ul className="grid gap-2 sm:grid-cols-2">
        {list.connectors.map((connector) => (
          <li key={connector.id} className="rounded-lg border border-border bg-panel px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Link2 className="size-3.5 text-muted-foreground" aria-hidden />
                {connector.label}
              </span>
              <span className={cn(
                'rounded-full border px-2 py-0.5 text-micro',
                connector.status === 'connected'
                  ? 'border-success/30 bg-success/10 text-success'
                  : connector.status === 'error'
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : 'border-border bg-card text-muted-foreground',
              )}>
                {connector.status === 'connected' ? '已连接' : connector.status === 'error' ? '配置错误' : '未连接'}
              </span>
            </div>
            <p className="mt-1 text-caption text-muted-foreground">{connector.detail}</p>
            <p className="mt-1 text-micro text-muted-foreground">
              {connector.read ? '只读' : '不可读'} · {connector.write === 'approval' ? '写入需审批' : '不开放写入'}
            </p>
          </li>
        ))}
      </ul>
      <div className="rounded-lg border border-border bg-card p-3">
        <h3 className="text-sm font-semibold text-foreground">只读 MCP 配方</h3>
        <ul className="mt-2 space-y-1.5">
          {list.recipes.map((recipe) => (
            <li key={recipe.id} className="text-caption text-muted-foreground">
              <span className="text-foreground">{recipe.title}</span> · {recipe.mode} · <span className="font-mono">{recipe.doc}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-caption text-muted-foreground">配方文档在仓库 docs/connectors/mcp-recipes/；v1 不做原生 OAuth。</p>
      </div>
    </div>
  )
}

export function ProjectSettingsPane({ project, onProjectUpdated, onNotice }: {
  project: CoworkProject
  onProjectUpdated: (project: CoworkProject) => void
  onNotice: (message: string) => void
}) {
  const [title, setTitle] = useState(project.title)
  const [instructions, setInstructions] = useState(project.instructions)
  const [roots, setRoots] = useState<string[]>(parseList(project.workspace_roots_json))
  const [dataPolicy, setDataPolicy] = useState(project.data_policy)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [connectors, setConnectors] = useState<CoworkConnectorList | null>(null)
  const [notifyOn, setNotifyOn] = useState(notifyEnabled())
  const [memoryQuery, setMemoryQuery] = useState('')
  const [memory, setMemory] = useState<CoworkMemoryFact[]>([])
  const [memoryBusy, setMemoryBusy] = useState(false)

  useEffect(() => {
    setTitle(project.title)
    setInstructions(project.instructions)
    setRoots(parseList(project.workspace_roots_json))
    setDataPolicy(project.data_policy)
    setMemory([])
    setMemoryQuery('')
  }, [project])

  useEffect(() => {
    let alive = true
    void api.coworkConnectors().then((data) => {
      if (alive) setConnectors(data)
    }).catch(() => { /* 连接器状态失败不阻断设置 */ })
    return () => { alive = false }
  }, [project.id])

  async function addRoot(): Promise<void> {
    try {
      const { path } = await api.selectFolder()
      if (path && !roots.includes(path)) setRoots([...roots, path])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function save(): Promise<void> {
    if (busy || !title.trim()) return
    setBusy(true)
    setError('')
    try {
      const { project: updated } = await api.updateCoworkProject(project.id, {
        title: title.trim(),
        instructions: instructions.trim(),
        workspace_roots: roots,
        data_policy: dataPolicy,
      })
      onProjectUpdated(updated)
      onNotice('项目设置已保存。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function searchMemory(): Promise<void> {
    setMemoryBusy(true)
    try {
      const data = await api.searchCoworkProjectMemory(project.id, memoryQuery)
      setMemory(data.memory)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMemoryBusy(false)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <SectionCard title="项目设置">
        <div className="space-y-3 p-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">项目名称</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">项目指令</span>
            <Textarea className="min-h-28" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="引用格式、必须附页码、样品编号等长期约束。" />
          </label>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">工作区根</span>
              <Button variant="outline" size="sm" onClick={() => void addRoot()}>
                <FolderOpen className="size-3.5" aria-hidden />
                添加
              </Button>
            </div>
            {roots.length === 0 ? <p className="text-caption text-muted-foreground">未绑定；项目任务需要落在某个根内才能创建。</p> : (
              <ul className="space-y-1">
                {roots.map((root) => (
                  <li key={root} className="flex items-center gap-2 rounded-md border border-border bg-panel px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted-foreground" title={root}>{root}</span>
                    <Button variant="ghost" size="icon-xs" aria-label={`移除 ${root}`} onClick={() => setRoots(roots.filter((item) => item !== root))}>
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">数据策略</span>
            <select value={dataPolicy} onChange={(event) => setDataPolicy(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="local_only">仅本地模型（local_only）</option>
              <option value="cloud">允许云端模型（cloud）</option>
            </select>
            <p className="text-caption text-muted-foreground">策略写入项目与任务；发送前提示与模型路由在 M4 补齐。</p>
          </div>
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button size="sm" disabled={busy || !title.trim()} onClick={() => void save()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              保存设置
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="项目记忆">
        <div className="p-4">
          <div className="flex gap-2">
            <Input
              value={memoryQuery}
              onChange={(event) => setMemoryQuery(event.target.value)}
              placeholder="搜索项目记忆，例如样品编号"
              onKeyDown={(event) => { if (event.key === 'Enter') void searchMemory() }}
            />
            <Button variant="outline" size="sm" onClick={() => void searchMemory()} disabled={memoryBusy}>
              {memoryBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Search className="size-3.5" aria-hidden />}
              搜索
            </Button>
          </div>
          <p className="mt-1.5 text-caption text-muted-foreground">任务完成摘要只在你验收时确认后写入；不会自动总结。</p>
          {memory.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">没有匹配的项目记忆。</p> : (
            <ul className="mt-3 space-y-2">
              {memory.map((fact) => (
                <li key={fact.id} className="rounded-md border border-border bg-panel px-3 py-2">
                  <p className="text-sm text-foreground">{fact.content}</p>
                  <p className="mt-1 text-caption text-muted-foreground">{fact.category} · {fact.updatedAt || '—'}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      <SectionCard title="通知">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm text-foreground">任务完成、失败与待审批的系统通知</p>
            <p className="text-caption text-muted-foreground">只在本应用后台时弹出；同一条事件不会重复通知。</p>
          </div>
          <Button variant={notifyOn ? 'default' : 'outline'} size="sm" onClick={() => {
            const next = !notifyOn
            setNotifyEnabled(next)
            setNotifyOn(next)
            onNotice(next ? '桌面通知已开启。' : '桌面通知已关闭。')
          }}>
            {notifyOn ? <Bell className="size-3.5" aria-hidden /> : <BellOff className="size-3.5" aria-hidden />}
            {notifyOn ? '通知已开启' : '通知已关闭'}
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="连接器">
        <ConnectorsList list={connectors} />
      </SectionCard>
    </div>
  )
}
