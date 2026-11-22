import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Plus, RefreshCw } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { NewTaskDialog } from '@/components/cowork/NewTaskDialog'
import { baseName, EmptyState, TaskListItem } from '@/components/cowork/taskUi'
import { TaskDetail } from '@/components/cowork/TaskDetailPane'
import { useCoworkStore } from '@/stores/cowork'
import type { CoworkArtifact } from '@/types/cowork'

export default function CoworkView() {
  const tasks = useCoworkStore((state) => state.tasks)
  const selectedId = useCoworkStore((state) => state.selectedId)
  const loading = useCoworkStore((state) => state.loading)
  const error = useCoworkStore((state) => state.error)
  const health = useCoworkStore((state) => state.health)
  const fetchTasks = useCoworkStore((state) => state.fetchTasks)
  const fetchHealth = useCoworkStore((state) => state.fetchHealth)
  const selectTask = useCoworkStore((state) => state.selectTask)
  const [creating, setCreating] = useState(false)
  const [autoSelected, setAutoSelected] = useState(false)

  useEffect(() => {
    void fetchTasks()
    void fetchHealth()
  }, [fetchTasks, fetchHealth])

  useEffect(() => {
    if (autoSelected || selectedId || tasks.length === 0) return
    setAutoSelected(true)
    void selectTask(tasks[0].id)
  }, [autoSelected, selectedId, tasks, selectTask])

  async function download(artifact: CoworkArtifact): Promise<void> {
    const id = useCoworkStore.getState().selectedId
    if (!id) return
    try {
      const url = await api.prepareCoworkArtifact(id, artifact.id)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.rel = 'noopener'
      anchor.download = baseName(artifact.path)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch (err) {
      useCoworkStore.setState({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">任务</h1>
            {health && (
              <span className="text-caption text-muted-foreground">
                {health.active_sessions} 个运行中会话
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            先计划、再执行；过程可审阅、可暂停、可恢复。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { void fetchTasks(); void fetchHealth() }} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            刷新
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" aria-hidden />
            新建任务
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
          <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
            <span className="text-caption font-medium uppercase tracking-widest text-muted-foreground">
              全部任务
            </span>
            <span className="text-caption text-muted-foreground">{tasks.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pb-3">
            {loading && tasks.length === 0 ? (
              <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                正在读取任务
              </div>
            ) : tasks.length === 0 ? (
              <p className="px-2 py-6 text-sm text-muted-foreground">还没有任务。新建一个开始。</p>
            ) : (
              <div className="space-y-1">
                {tasks.map((task) => (
                  <TaskListItem
                    key={task.id}
                    task={task}
                    active={task.id === selectedId}
                    onSelect={() => void selectTask(task.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto scrollbar-thin">
          {error && (
            <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
          {tasks.length === 0 && !loading ? (
            <EmptyState onCreate={() => setCreating(true)} />
          ) : (
            <TaskDetail onDownload={(artifact) => void download(artifact)} />
          )}
        </main>
      </div>

      <NewTaskDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
