import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bell, BellOff, Loader2, Plus, RefreshCw } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { CoworkActivityDialog } from '@/components/cowork/CoworkActivityDialog'
import { CoworkProjectsRail } from '@/components/cowork/CoworkProjectsRail'
import { NewProjectDialog } from '@/components/cowork/NewProjectDialog'
import { NewTaskDialog } from '@/components/cowork/NewTaskDialog'
import { ProjectTasksPane } from '@/components/cowork/ProjectTasksPane'
import { ProjectWorkspace, type ProjectTab } from '@/components/cowork/ProjectWorkspace'
import { baseName, EmptyState, TaskListItem } from '@/components/cowork/taskUi'
import { TaskDetail } from '@/components/cowork/TaskDetailPane'
import { useCoworkStore } from '@/stores/cowork'
import { notifyEnabled, setNotifyEnabled } from '@/utils/coworkNotify'
import type { CoworkArtifact, CoworkProject } from '@/types/cowork'

function parseRoots(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export default function CoworkView() {
  const tasks = useCoworkStore((state) => state.tasks)
  const selectedId = useCoworkStore((state) => state.selectedId)
  const loading = useCoworkStore((state) => state.loading)
  const error = useCoworkStore((state) => state.error)
  const health = useCoworkStore((state) => state.health)
  const fetchTasks = useCoworkStore((state) => state.fetchTasks)
  const fetchHealth = useCoworkStore((state) => state.fetchHealth)
  const selectTask = useCoworkStore((state) => state.selectTask)
  const [projects, setProjects] = useState<CoworkProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectTab, setProjectTab] = useState<ProjectTab>('tasks')
  const [notice, setNotice] = useState('')
  const [creatingTask, setCreatingTask] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityCount, setActivityCount] = useState(0)
  const [notifyOn, setNotifyOn] = useState(notifyEnabled())

  const refreshProjects = useCallback(async (): Promise<CoworkProject[]> => {
    setProjectsLoading(true)
    try {
      const { projects: list } = await api.listCoworkProjects()
      setProjects(list)
      setProjectsError('')
      return list
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : String(err))
      return []
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTasks()
    void fetchHealth()
    void refreshProjects()
    void api.coworkActivity(30).then((data) => setActivityCount(data.activity.length)).catch(() => { /* 活动数量失败不影响任务 */ })
  }, [fetchTasks, fetchHealth, refreshProjects])

  const project = projectId ? projects.find((item) => item.id === projectId) ?? null : null
  const visibleTasks = projectId ? tasks.filter((task) => task.project_id === projectId) : tasks

  // 切换项目后，旧选择不属于当前项目；只在新项目确有任务时自动选第一个。
  useEffect(() => {
    if (visibleTasks.length === 0) return
    if (!selectedId || !visibleTasks.some((task) => task.id === selectedId)) {
      void selectTask(visibleTasks[0]?.id ?? null)
    }
  }, [visibleTasks, selectedId, selectTask])

  // 选中的项目被删除或列表尚未加载时，回到全部任务；避免空白项目页。
  useEffect(() => {
    if (!projectId || projectsLoading) return
    if (!projects.some((item) => item.id === projectId)) {
      setProjectId(null)
      setProjectTab('tasks')
    }
  }, [projectId, projects, projectsLoading])

  function toggleNotify(): void {
    const next = !notifyOn
    setNotifyEnabled(next)
    setNotifyOn(next)
  }

  function selectProject(id: string): void {
    setProjectId(id)
    setProjectTab('tasks')
    setNotice('')
    void selectTask(null)
    void api.getCoworkProject(id).then((detail) => {
      setProjects((list) => list.map((item) => (item.id === detail.project.id ? detail.project : item)))
    }).catch(() => { /* 详情失败保留列表数据 */ })
  }

  async function onProjectCreated(id: string): Promise<void> {
    const list = await refreshProjects()
    if (!list.some((item) => item.id === id)) {
      try {
        const detail = await api.getCoworkProject(id)
        setProjects((current) => [detail.project, ...current.filter((item) => item.id !== id)])
      } catch {
        // 新项目已在后端创建；列表刷新失败时下次刷新会补上。
      }
    }
    setProjectId(id)
    setProjectTab('tasks')
    setNotice('项目已创建。先添加资产或建任务。')
  }

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

  const detailPane = <TaskDetail onDownload={(artifact) => void download(artifact)} />
  const projectRoots = project ? parseRoots(project.workspace_roots_json) : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      {projectsError && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">项目列表读取失败：{projectsError}</span>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
        <CoworkProjectsRail
          projects={projects}
          tasks={tasks}
          projectId={projectId}
          onSelectProject={selectProject}
          onSelectAll={() => { setProjectId(null); setProjectTab('tasks'); setNotice('') }}
          onCreateProject={() => setCreatingProject(true)}
          onOpenActivity={() => setActivityOpen(true)}
          activityCount={activityCount}
          loading={projectsLoading}
        />

        {project ? (
          <ProjectWorkspace
            project={project}
            tasks={visibleTasks}
            tab={projectTab}
            onTabChange={setProjectTab}
            onProjectUpdated={(updated) => setProjects((list) => list.map((item) => (item.id === updated.id ? updated : item)))}
            onNewTask={() => setCreatingTask(true)}
            notifyOn={notifyOn}
            onToggleNotify={toggleNotify}
            notice={notice}
            onNoticeClose={() => setNotice('')}
          >
            <ProjectTasksPane
              tasks={visibleTasks}
              selectedId={selectedId}
              loading={loading}
              onSelect={(id) => void selectTask(id)}
              onNewTask={() => setCreatingTask(true)}
            >
              {detailPane}
            </ProjectTasksPane>
          </ProjectWorkspace>
        ) : (
          <div className="flex min-h-0 flex-col">
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-semibold tracking-tight text-foreground">全部任务</h1>
                  {health && (
                    <span className="text-caption text-muted-foreground">{health.active_sessions} 个运行中会话</span>
                  )}
                  <span className="rounded-full border border-border bg-panel px-2 py-1.5 text-micro text-muted-foreground">
                    {projects.length} 个项目
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  先计划、再执行；过程可审阅、可暂停、可恢复。项目内的任务共享指令、资产与定时。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon-sm" aria-label={notifyOn ? '关闭桌面通知' : '开启桌面通知'} onClick={toggleNotify}>
                  {notifyOn ? <Bell className="size-4" aria-hidden /> : <BellOff className="size-4 text-muted-foreground" aria-hidden />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { void fetchTasks(); void fetchHealth() }} disabled={loading}>
                  {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                  刷新
                </Button>
                <Button size="sm" onClick={() => setCreatingTask(true)}>
                  <Plus className="size-3.5" aria-hidden />
                  新建任务
                </Button>
              </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
                <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
                  <span className="text-caption font-medium uppercase tracking-widest text-muted-foreground">全部任务</span>
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
                        <TaskListItem key={task.id} task={task} active={task.id === selectedId} onSelect={() => void selectTask(task.id)} />
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
                {tasks.length === 0 && !loading ? <EmptyState onCreate={() => setCreatingTask(true)} /> : detailPane}
              </main>
            </div>
          </div>
        )}
      </div>

      <NewTaskDialog
        open={creatingTask}
        onOpenChange={setCreatingTask}
        projectId={projectId ?? undefined}
        projectTitle={project?.title}
        projectRoots={projectRoots}
      />
      <NewProjectDialog open={creatingProject} onOpenChange={setCreatingProject} onCreated={(id) => void onProjectCreated(id)} />
      <CoworkActivityDialog open={activityOpen} onOpenChange={(open) => {
        setActivityOpen(open)
        if (open) void api.coworkActivity(30).then((data) => setActivityCount(data.activity.length)).catch(() => {})
      }} />
    </div>
  )
}
