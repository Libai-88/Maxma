import { Clock3, FolderKanban, ListChecks, Plus, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CoworkProject, CoworkTask } from '@/types/cowork'

export function CoworkProjectsRail({ projects, tasks, projectId, onSelectProject, onSelectAll, onCreateProject, onOpenActivity, activityCount, onOpenApprovals, approvalCount, loading }: {
  projects: CoworkProject[]
  tasks: CoworkTask[]
  projectId: string | null
  onSelectProject: (id: string) => void
  onSelectAll: () => void
  onCreateProject: () => void
  onOpenActivity: () => void
  activityCount: number
  onOpenApprovals: () => void
  approvalCount: number
  loading: boolean
}) {
  return (
    <aside className="flex min-h-0 flex-col border-b border-border bg-panel/40 lg:border-r lg:border-b-0">
      <div className="flex shrink-0 items-center justify-between px-3 py-2.5">
        <span className="text-caption font-medium uppercase tracking-widest text-muted-foreground">项目</span>
        <Button variant="ghost" size="icon-xs" aria-label="新建项目" onClick={onCreateProject}>
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        <button
          type="button"
          aria-current={projectId === null ? 'true' : undefined}
          onClick={onSelectAll}
          className={cn(
            'mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
            projectId === null ? 'bg-accent/60 font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
          )}
        >
          <ListChecks className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">全部任务</span>
          <span className="text-caption text-muted-foreground">{tasks.length}</span>
        </button>

        {projects.length === 0 && !loading ? (
          <p className="px-2.5 py-3 text-caption text-muted-foreground">还没有项目。建一个把资料、任务和定时收在一起。</p>
        ) : (
          <div className="space-y-1">
            {projects.map((project) => {
              const count = tasks.filter((task) => task.project_id === project.id).length
              return (
                <button
                  key={project.id}
                  type="button"
                  aria-current={projectId === project.id ? 'true' : undefined}
                  onClick={() => onSelectProject(project.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                    projectId === project.id ? 'bg-accent/60' : 'hover:bg-accent/40',
                  )}
                >
                  <FolderKanban className={cn('mt-0.5 size-4 shrink-0', projectId === project.id ? 'text-foreground' : 'text-muted-foreground')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm', projectId === project.id ? 'font-medium text-foreground' : 'text-foreground/85')}>
                      {project.title}
                    </span>
                    <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                      {count} 个任务
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="shrink-0 space-y-0.5 border-t border-border p-2">
        <button
          type="button"
          onClick={onOpenApprovals}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors duration-fast ease-standard hover:bg-accent/40 hover:text-foreground"
        >
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">审批中心</span>
          {approvalCount > 0 && (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1.5 text-micro text-primary">
              {Math.min(approvalCount, 99)}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenActivity}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors duration-fast ease-standard hover:bg-accent/40 hover:text-foreground"
        >
          <Clock3 className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">活动中心</span>
          {activityCount > 0 && (
            <span className="rounded-full bg-panel px-2 py-1.5 text-micro text-muted-foreground">{Math.min(activityCount, 99)}</span>
          )}
        </button>
      </div>
    </aside>
  )
}
