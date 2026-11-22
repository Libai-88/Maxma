import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { TaskListItem } from '@/components/cowork/taskUi'
import type { CoworkTask } from '@/types/cowork'

export function ProjectTasksPane({ tasks, selectedId, loading, onSelect, onNewTask, children }: {
  tasks: CoworkTask[]
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onNewTask: () => void
  children?: ReactNode
}) {
  return (
    <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
        <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
          <span className="text-caption font-medium uppercase tracking-widest text-muted-foreground">项目任务</span>
          <span className="text-caption text-muted-foreground">{tasks.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pb-3">
          {loading && tasks.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              正在读取任务
            </div>
          ) : tasks.length === 0 ? (
            <div className="px-2 py-6 text-sm text-muted-foreground">
              <p>这个项目还没有任务。</p>
              <Button className="mt-2" variant="outline" size="sm" onClick={onNewTask}>新建任务</Button>
            </div>
          ) : (
            <div className="space-y-1">
              {tasks.map((task) => (
                <TaskListItem key={task.id} task={task} active={task.id === selectedId} onSelect={() => onSelect(task.id)} />
              ))}
            </div>
          )}
        </div>
      </aside>
      <div className="min-h-0">
        {selectedId ? children : (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-6 text-center">
            <CheckCircle2 className="size-8 text-muted-foreground/60" aria-hidden />
            <p className="mt-3 text-sm font-medium text-foreground">选择一个任务查看计划与验收</p>
            <p className="mt-1 max-w-sm text-caption text-muted-foreground">
              任务完成后在这里验收；验收时可把摘要确认写进项目记忆。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export function ProjectErrorBanner({ message }: { message: string }) {
  if (!message) return null
  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  )
}
