import { ClipboardList, FileText, FolderOpen, TimerReset } from 'lucide-react'

/**
 * Cowork 任务入口（M0 占位）。
 *
 * M0 只冻结基线、加能力开关、准备回滚与基准套件，不伪造任务执行。
 * 这里展示的是“接下来要建什么”，不是可点击的假工作流；任务列表、计划审批、
 * 交付物与定时任务在 M1–M3 逐项落地。
 */
export default function CoworkView() {
  const upcoming = [
    { icon: ClipboardList, title: '任务对象', desc: '目标、步骤、暂停/恢复、重启后继续' },
    { icon: FileText, title: '可编辑交付物', desc: 'Word / Excel / PPT / PDF，版本化、可导出' },
    { icon: FolderOpen, title: '项目与资料', desc: '工作区、模板、文档索引、项目记忆' },
    { icon: TimerReset, title: '本地定时', desc: '应用运行时触发；不冒充云端调度' },
  ]

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6">
        <header className="rounded-lg bg-card p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-border bg-panel px-3 py-1.5 text-caption font-medium text-muted-foreground">
              M0 基线
            </span>
            <span className="inline-flex items-center rounded-full border border-border bg-panel px-3 py-1.5 text-caption font-medium text-muted-foreground">
              默认关闭
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">任务</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Maxma 的本地优先任务交付工作台。给目标、文件夹和模板，Maxma 先计划、再执行，
            把可编辑的 Word / Excel / PPT / PDF 放回来；过程可审阅、可暂停、可恢复、可回滚。
          </p>
          <p className="mt-3 rounded-md border border-border bg-panel px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            当前是 M0：只完成了基线冻结、能力开关、备份/回滚护栏和基准套件骨架。
            任务内核将在 M1 接入，届时这里才会出现真实可用的任务列表与运行控制。
          </p>
        </header>

        <section className="rounded-lg bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">接下来会建什么</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {upcoming.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-3 rounded-md border border-border bg-panel p-4">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            现有对话、工作台与代码能力不受影响；M0 的开关关闭时，应用行为与 v2.7.0 基线一致。
          </p>
        </section>
      </div>
    </div>
  )
}
