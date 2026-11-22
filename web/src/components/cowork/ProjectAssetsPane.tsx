import { useEffect, useState } from 'react'
import { FileText, FolderOpen, Loader2, Plus, Trash2 } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { baseName, formatBytes } from '@/components/cowork/taskUi'
import type { CoworkProjectAsset, CoworkTask } from '@/types/cowork'

function assetIcon(asset: CoworkProjectAsset) {
  const ext = baseName(asset.path).split('.').pop()?.toLowerCase() ?? ''
  if (['pdf', 'docx', 'doc', 'md', 'txt'].includes(ext)) {
    return <FileText className="size-4 text-muted-foreground" aria-hidden />
  }
  return <FolderOpen className="size-4 text-muted-foreground" aria-hidden />
}

export function ProjectAssetsPane({ projectId, tasks, onNotice }: {
  projectId: string
  tasks: CoworkTask[]
  onNotice: (message: string) => void
}) {
  const [assets, setAssets] = useState<CoworkProjectAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [error, setError] = useState('')

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const detail = await api.getCoworkProject(projectId)
      setAssets(detail.assets)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setAssets([])
    setTaskId('')
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function chooseFile(): Promise<void> {
    setAdding(true)
    setError('')
    try {
      const { path } = await api.selectFile('file')
      if (!path) return
      await api.addCoworkProjectAsset(projectId, { path })
      onNotice('资产已加入项目。')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  async function remove(asset: CoworkProjectAsset): Promise<void> {
    try {
      await api.removeCoworkProjectAsset(projectId, asset.id)
      onNotice(`已移除引用：${asset.label}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function attach(asset: CoworkProjectAsset): Promise<void> {
    const target = taskId || tasks.find((task) => task.status === 'draft')?.id
    if (!target) {
      setError('先建一个待启动任务，再挂资产。')
      return
    }
    try {
      await api.attachCoworkProjectAsset(projectId, asset.id, target)
      onNotice(`已加入任务输入：${asset.label}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">项目资产</h2>
          <p className="text-caption text-muted-foreground">只存引用与索引，源文件仍在原工作区；不会复制。</p>
        </div>
        <Button size="sm" onClick={() => void chooseFile()} disabled={adding}>
          {adding ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
          添加文件
        </Button>
      </div>

      {tasks.some((task) => task.status === 'draft') && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2">
          <span className="text-sm text-muted-foreground">加入任务</span>
          <select
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            <option value="">默认第一个待启动任务</option>
            {tasks.filter((task) => task.status === 'draft').map((task) => (
              <option key={task.id} value={task.id}>{task.title}</option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      {loading && assets.length === 0 ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          正在读取资产
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          还没有资产。添加工作区里的文件，或让任务生成产物后再引用。
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {assets.map((asset) => (
            <li key={asset.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-panel">{assetIcon(asset)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{asset.label}</p>
                <p className="truncate font-mono text-caption text-muted-foreground" title={asset.path}>{asset.path}</p>
              </div>
              <span className="rounded-full border border-border bg-panel px-2 py-1.5 text-micro text-muted-foreground">
                {asset.source === 'project' ? '项目产物' : '工作区引用'}
              </span>
              <span className="text-caption text-muted-foreground">{formatBytes(asset.size_bytes)}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => {
                  if (!window.maxmaDesktop?.openPath) {
                    setError('打开本地文件需要桌面应用。')
                    return
                  }
                  void window.maxmaDesktop.openPath(asset.path).catch((err) => setError(err instanceof Error ? err.message : String(err)))
                }}>
                  打开
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void attach(asset)}>加入任务</Button>
                <Button variant="ghost" size="icon-sm" aria-label={`移除 ${asset.label}`} onClick={() => void remove(asset)}>
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
