import { DotLoader } from '@/components/ui/dot-loader'
import { StatusGlyph } from '@/components/ui/status-glyph'

const SUGGESTIONS: Array<{ title: string; prompt: string }> = [
  { title: '周报起草', prompt: '帮我起草本周工作周报：覆盖进度、风险与下周计划，语气克制、先结论后过程。' },
  { title: '代码梳理', prompt: '梳理当前项目的目录结构与核心模块职责，指出职责模糊或重复的部分。' },
  { title: '方案对比', prompt: '对比两个技术方案的优劣，先给判断标准再下结论，不确定的地方如实标注。' },
  { title: '翻译润色', prompt: '把一段中文润色成自然的英文，保留原意与语气，术语保持一致。' },
]

/** 空态欢迎屏。建议项走 onStart（预填输入框，不直发——用户需要补充项目名与时间范围）。 */
export function WelcomeScreen({ onStart }: { onStart: (message: string) => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl border border-border bg-card shadow-[inset_0_1px_0_var(--glass-rim)]">
          <StatusGlyph activity="thinking" className="size-6" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">有什么可以帮你想清楚的？</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          先结论再过程，不确定的地方如实标注。建议点击后会填入输入框，你可以先补充上下文。
        </p>
        <div className="mt-7 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => onStart(s.prompt)}
              className="glass-panel rounded-lg p-3 text-left transition-colors outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <span className="block text-[13px] font-medium">{s.title}</span>
              <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{s.prompt}</span>
            </button>
          ))}
        </div>
        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <DotLoader />
          <span>输入 / 查看全部命令</span>
        </div>
      </div>
    </div>
  )
}
