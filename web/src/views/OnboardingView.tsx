import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MessageSquare, Wrench, Sparkles, Brain, Lock, Info, type LucideIcon } from 'lucide-react'
import { useOnboardingStore } from '@/stores/onboarding'
import { useHealthStore } from '@/stores/health'
import { cn } from '@/lib/utils'

const titles = ['欢迎使用', '连接模型', '设定工作区', '快速了解']

type ThemeMode = 'light' | 'dark'

function readTheme(): ThemeMode {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  try { localStorage.setItem('maxma-theme', mode) } catch { /* 忽略持久化失败 */ }
}

const INTRO_CHIPS: { label: string; Icon: LucideIcon }[] = [
  { label: '多模型对话', Icon: MessageSquare },
  { label: 'MCP 工具', Icon: Wrench },
  { label: 'Skills 技能', Icon: Sparkles },
  { label: '长期记忆', Icon: Brain },
  { label: '人设系统', Icon: Sparkles },
  { label: '本地优先', Icon: Lock },
]

const NEXT_STEPS: { no: number; title: string; desc: ReactNode }[] = [
  {
    no: 1,
    title: '回到对话页开始聊天',
    desc: <>点击左侧「对话」入口，输入任何问题或试试内置示例。</>,
  },
  {
    no: 2,
    title: '按需扩展能力',
    desc: <>想读写文件？配置 <strong className="text-foreground font-semibold">MCP</strong>。想固定流程？创建 <strong className="text-foreground font-semibold">Skill</strong>。想记住偏好？启用 <strong className="text-foreground font-semibold">长期记忆</strong>。</>,
  },
  {
    no: 3,
    title: '查看帮助与对比',
    desc: <>不确定 Maxma 是否适合你？前往「设置 → 帮助」查看与 Claude Desktop / ChatGPT Desktop 的对比。</>,
  },
]

function OnboardingInner({ paused }: { paused: boolean }) {
  const updatePreferences = useOnboardingStore(s => s.updatePreferences)
  const complete = useOnboardingStore(s => s.complete)
  const health = useHealthStore(s => s.health)
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [displayName, setDisplayName] = useState(() => useOnboardingStore.getState().snapshot.preferences.displayName)
  const [language, setLanguage] = useState<'zh-CN' | 'en'>(() => useOnboardingStore.getState().snapshot.preferences.language)
  const [workspace, setWorkspace] = useState<'personal' | 'project'>(() => useOnboardingStore.getState().snapshot.preferences.workspace)
  const [themeMode, setThemeMode] = useState<ThemeMode>(readTheme)

  useEffect(() => {
    updatePreferences({ displayName, language, workspace })
  }, [displayName, language, workspace, updatePreferences])

  const providerReady = health?.llm?.status === 'ok'

  function next() {
    if (step === titles.length - 1) complete()
    else setStep(s => s + 1)
  }
  function chooseTheme(mode: ThemeMode) {
    setThemeMode(mode)
    applyTheme(mode)
  }

  return (
    <div
      className={cn('fixed inset-0 z-[1000] grid place-items-center bg-background/80 backdrop-blur-sm p-3', paused && 'hidden')}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        tabIndex={-1}
        onKeyDown={e => { if (e.key === 'Escape') complete() }}
        className="w-full max-w-[560px] border border-border rounded-lg bg-card backdrop-blur-xl shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4 px-6 py-[22px] border-b border-border">
          <div>
            <p className="text-xs tracking-[0.08em] text-muted-foreground">MAXMAHERE</p>
            <h2 id="onboarding-title" className="text-[22px] font-semibold text-foreground mt-0.5">{titles[step]}</h2>
          </div>
          <button onClick={() => complete()} className="px-4 py-2.5 border border-border rounded-lg text-sm text-muted-foreground hover:bg-secondary transition-colors">跳过</button>
        </div>

        <div className="flex gap-1.5 px-6 pt-[18px]" aria-label="引导进度">
          {titles.map((_, index) => (
            <span key={index} className={cn('block h-[3px] flex-1 rounded-full bg-border transition-colors', (index === step || index < step) && 'bg-primary')} />
          ))}
        </div>

        <div key={step} className="grid gap-[18px] min-h-[260px] px-7 py-7 text-muted-foreground leading-[1.7]">
          {step === 0 && (
            <>
              <div className="grid gap-3 p-3.5 border border-border rounded-lg bg-secondary">
                <p className="text-[13px] leading-[1.7] text-muted-foreground">
                  <strong className="text-foreground font-semibold">Maxma</strong> 是一款本地优先的 AI 桌面工作站——把大模型对话、工具调用、长期记忆与人设系统整合在一个应用里，所有数据都保存在你的电脑上。
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {INTRO_CHIPS.map(({ label, Icon }) => (
                    <span key={label} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground bg-card rounded-full border border-border">
                      <Icon className="size-3" />{label}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">这些偏好只保存在当前设备，之后可从设置中调整。</p>
              <label className="grid gap-1.5 text-sm text-foreground">
                称呼
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  maxLength={80}
                  autoComplete="name"
                  placeholder="选填"
                  className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-foreground text-sm outline-none focus:border-ring"
                />
              </label>
              <label className="grid gap-1.5 text-sm text-foreground">
                语言
                <select
                  value={language}
                  onChange={e => setLanguage(e.target.value as 'zh-CN' | 'en')}
                  className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-foreground text-sm outline-none focus:border-ring"
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm leading-[1.7]">Maxma 已内置免费模型通道，选择 MiMo V2.6 或 Space Bunny 即可开始对话，无需登录、注册或填写 API Key。也可以连接你自己的云端或本地模型。</p>
              <p className={cn('text-sm border-l-[3px] pl-2.5', providerReady ? 'border-success text-success' : 'border-status-interrupted text-status-interrupted')}>
                {providerReady ? '检测到可用的模型服务。' : '尚未检测到可用的模型服务——可点击下方按钮前往配置。'}
              </p>
              <div className="flex gap-2.5 p-2.5 border border-dashed border-border rounded-lg bg-secondary text-xs leading-relaxed">
                <Info className="size-3.5 shrink-0 text-muted-foreground" />
                <div>想立即开始就选内置免费模型；需要更高配额或完全离线时，再添加 <strong className="text-foreground font-semibold">DeepSeek</strong> 或 <strong className="text-foreground font-semibold">Ollama</strong>。</div>
              </div>
              <button onClick={() => navigate('/providers')} className="justify-self-start px-4 py-2.5 border border-border rounded-lg text-sm text-muted-foreground hover:bg-secondary transition-colors">前往模型设置</button>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm">选择你偏好的界面主题和工作方式。</p>
              <div className="grid grid-cols-2 gap-2">
                {([{ id: 'light', name: '浅色' }, { id: 'dark', name: '深色' }] as { id: ThemeMode; name: string }[]).map(t => (
                  <button
                    key={t.id}
                    onClick={() => chooseTheme(t.id)}
                    className={cn('flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm text-muted-foreground hover:bg-secondary transition-colors', themeMode === t.id ? 'border-ring text-foreground bg-secondary' : 'border-border')}
                  >
                    <span className={cn('size-4 rounded-md border border-border', t.id === 'light' ? 'bg-background' : 'bg-foreground')} />
                    {t.name}
                  </button>
                ))}
              </div>
              <label className="grid gap-1.5 text-sm text-foreground">
                工作区
                <select
                  value={workspace}
                  onChange={e => setWorkspace(e.target.value as 'personal' | 'project')}
                  className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-foreground text-sm outline-none focus:border-ring"
                >
                  <option value="personal">个人对话</option>
                  <option value="project">项目工作</option>
                </select>
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-[15px] font-semibold text-foreground">准备就绪！现在可以开始使用 Maxma 了。</p>
              <div className="grid gap-2.5">
                {NEXT_STEPS.map(s => (
                  <div key={s.no} className="flex gap-3 p-2.5 border border-border rounded-lg bg-secondary">
                    <span className="size-[22px] rounded-full bg-primary text-primary-foreground text-xs font-bold inline-flex items-center justify-center shrink-0">{s.no}</span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-foreground mb-0.5">{s.title}</div>
                      <div className="text-xs text-muted-foreground leading-[1.5]">{s.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">没有配置模型时，你仍可查看已有的会话与本地内容；之后随时可从「设置」重新打开此引导。</p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 px-6 py-[22px] border-t border-border">
          {step > 0 ? (
            <button onClick={() => setStep(s => s - 1)} className="px-4 py-2.5 border border-border rounded-lg text-sm text-muted-foreground hover:bg-secondary transition-colors">上一步</button>
          ) : <span />}
          <button autoFocus onClick={next} className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold transition-colors">
            {step === titles.length - 1 ? '开始使用' : '继续'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default function OnboardingView() {
  const initialized = useOnboardingStore(s => s.initialized)
  const completed = useOnboardingStore(s => s.snapshot.completed)
  const { pathname } = useLocation()
  if (!initialized || completed) return null
  return <OnboardingInner paused={pathname === '/providers'} />
}
