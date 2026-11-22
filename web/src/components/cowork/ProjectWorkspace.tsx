import { useState, type ReactNode } from 'react'
import { Bell, BellOff, Loader2, Plus, RefreshCw, X } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ProjectAssetsPane } from '@/components/cowork/ProjectAssetsPane'
import { ProjectSchedulesPane } from '@/components/cowork/ProjectSchedulesPane'
import { ProjectSettingsPane } from '@/components/cowork/ProjectSettingsPane'
import type { CoworkProject, CoworkTask } from '@/types/cowork'

export type ProjectTab = 'tasks' | 'assets' | 'schedules' | 'settings'

const TAB_LABELS: Record<ProjectTab, string> = {
  tasks: '任务',
  assets: '资产',
  schedules: '定时',
  settings: '设置',
}

function parseRoots(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function ProjectNotice({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null
  return (
    <div className="mx-4 mt-3 flex items-center justify-between gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
      <span>{message}</span>
      <Button variant="ghost" size="icon-xs" aria-label="关闭提示" onClick={onClose}>
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  )
}

export function ProjectWorkspace({ project, tasks, tab, onTabChange, onProjectUpdated, onNewTask, notifyOn, onToggleNotify, notice, onNoticeClose, children }: {
  project: CoworkProject
  tasks: CoworkTask[]
  tab: ProjectTab
  onTabChange: (tab: ProjectTab) => void
  onProjectUpdated: (project: CoworkProject) => void
  onNewTask: () => void
  notifyOn: boolean
  onToggleNotify: () => void
  notice: string
  onNoticeClose: () => void
  children: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [noticeMessage, setNoticeMessage] = useState('')
  const roots = parseRoots(project.workspace_roots_json)
  const shownNotice = noticeMessage || notice

  async function refresh(): Promise<void> {
    setBusy(true)
    try {
      const detail = await api.getCoworkProject(project.id)
      onProjectUpdated(detail.project)
    } catch {
      // 刷新失败保留旧项目；用户仍可继续操作。
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border px-5 pt-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{project.title}</h1>
              <span className="shrink-0 rounded-full border border-border bg-panel px-2 py-1.5 text-micro text-muted-foreground">项目</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {project.instructions.trim() || '还没有项目指令；在设置里补上引用与交付约束。'}
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              {roots.length > 0 ? `${roots.length} 个工作区根` : '未绑定工作区根'} · {project.data_policy === 'cloud' ? '允许云端模型' : '仅本地模型'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" aria-label={notifyOn ? '关闭桌面通知' : '开启桌面通知'} title={notifyOn ? '桌面通知已开启' : '桌面通知已关闭'} onClick={onToggleNotify}>
              {notifyOn ? <Bell className="size-4" aria-hidden /> : <BellOff className="size-4 text-muted-foreground" aria-hidden />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
              刷新
            </Button>
            <Button size="sm" onClick={onNewTask}>
              <Plus className="size-3.5" aria-hidden />
              新建任务
            </Button>
          </div>
        </div>
        <div role="tablist" aria-label="项目视图" className="mt-3 flex gap-1">
          {(Object.keys(TAB_LABELS) as ProjectTab[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => onTabChange(item)}
              className={cn(
                'rounded-t-md px-3 py-2 text-sm transition-colors',
                tab === item
                  ? 'bg-accent/60 font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
              )}
            >
              {TAB_LABELS[item]}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <ProjectNotice message={shownNotice} onClose={() => { setNoticeMessage(''); onNoticeClose() }} />
        {tab === 'tasks' ? children : null}
        {tab === 'assets' ? <ProjectAssetsPane projectId={project.id} tasks={tasks} onNotice={setNoticeMessage} /> : null}
        {tab === 'schedules' ? <ProjectSchedulesPane projectId={project.id} tasks={tasks} onNotice={setNoticeMessage} /> : null}
        {tab === 'settings' ? <ProjectSettingsPane project={project} onProjectUpdated={onProjectUpdated} onNotice={setNoticeMessage} /> : null}
      </div>
    </div>
  )
}
