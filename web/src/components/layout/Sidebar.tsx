import { NavLink, useLocation } from 'react-router-dom'
import { MessageSquare, Cpu, Brain, Sparkles, BarChart3, Blocks, Puzzle, Activity, Settings2, PanelLeft, Moon, ClipboardList } from 'lucide-react'
import { useCapabilitiesStore } from '@/stores/capabilities'
import { useChatStore } from '@/stores/chat'
import { cn } from '@/lib/utils'
import { focusRing, interactive } from '@/lib/ui'
import { useScrollFade } from '@/lib/useScrollFade'

interface NavItem { to: string; label: string; icon: typeof MessageSquare; feature?: string }
interface NavGroup { key: string; label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'work', label: '工作', items: [
      { to: '/', label: '对话', icon: MessageSquare },
      { to: '/cowork', label: '任务', icon: ClipboardList, feature: 'cowork' },
      { to: '/providers', label: '模型', icon: Cpu },
      { to: '/memory', label: '记忆', icon: Brain, feature: 'memory' },
      { to: '/evolution', label: '偏好', icon: Sparkles, feature: 'memory' },
    ],
  },
  {
    key: 'tools', label: '工具', items: [
      { to: '/metrics', label: '运行指标', icon: BarChart3 },
      { to: '/extensions', label: '扩展', icon: Blocks },
      { to: '/plugins', label: '插件', icon: Puzzle, feature: 'plugins' },
      { to: '/activity', label: '活动', icon: Activity },
    ],
  },
]

/** 一行导航。三处（工作/工具/系统）原本各手写一遍同样的类串，改一次要改三处。 */
function NavRow({ to, label, icon: Icon, active, trailing }: {
  to: string
  label: string
  icon: typeof MessageSquare
  active: boolean
  trailing?: React.ReactNode
}) {
  return (
    <NavLink
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-lg px-3.5 density-row text-ui',
        interactive, focusRing,
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {/* The one state: a line of ink down the left edge of where you are.
          Hover gets a fainter one, so the row answers before it is pressed. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand',
          interactive,
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
        )}
      />
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
      {trailing}
    </NavLink>
  )
}

export function Sidebar({ onToggleSessions }: { onToggleSessions: () => void }) {
  const capabilities = useCapabilitiesStore((s) => s.capabilities)
  const channels = useChatStore((s) => s.channels)
  const version = useChatStore((s) => s.version)
  void version
  const hasStreaming = Array.from(channels.values()).some((c) => c.isStreaming)
  const location = useLocation()
  const navScrollRef = useScrollFade<HTMLElement>()

  const hasFeature = (name?: string) => {
    if (!name) return true
    // 清单未加载时，既有入口乐观放行（与旧 Dock 一致）；Cowork 是 M0 新入口，
    // 在拿到清单前必须默认隐藏，不能先闪一个未启用的“任务”入口。
    if (!capabilities) return name !== 'cowork'
    const cfg = capabilities.features?.[name]
    return !cfg || cfg.enabled !== false
  }

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => hasFeature(i.feature)) }))
    .filter((g) => g.items.length > 0)

  const isActive = (to: string) => to === '/' ? location.pathname === '/' : location.pathname === to || location.pathname.startsWith(`${to}/`)

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-background/60" aria-label="主导航">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        {/* The mark, not a placeholder square: the ink of the brand, a stroke
            that reads as an M at 24px and as a glyph at 16px. */}
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand/12 ring-1 ring-brand/25">
          <svg viewBox="0 0 16 16" className="size-3.5 text-brand" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 12V4.5l4.5 4 4.5-4V12" />
          </svg>
        </div>
        <span className="text-subtitle font-semibold tracking-tight">Maxma</span>
      </div>

      <nav ref={navScrollRef} className="flex flex-col flex-1 density-stack overflow-y-auto scrollbar-thin scroll-fade px-2 py-4" aria-label="页面导航">
        {visibleGroups.map((group) => (
          <div key={group.key} role="group" aria-label={group.label}>
            <p className="px-3.5 pb-1.5 text-caption font-medium uppercase tracking-widest text-muted-foreground">{group.label}</p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavRow
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(item.to)}
                  trailing={item.to === '/' && hasStreaming
                    ? <span className="ml-auto size-1.5 animate-pulse rounded-full bg-foreground" aria-label="正在生成" />
                    : null}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border px-2 py-3" role="group" aria-label="系统">
        <p className="px-3.5 pb-1.5 text-caption font-medium uppercase tracking-widest text-muted-foreground">系统</p>
        {/* 会话不是路由，是一个抽屉，所以它不是一个 NavRow：同样的形状，
            同样的焦点环，只是没有“当前页”。 */}
        <button
          type="button"
          onClick={onToggleSessions}
          aria-label="会话列表"
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-3.5 py-2 text-left text-ui text-muted-foreground',
            interactive, focusRing,
            'hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <PanelLeft className="size-4 shrink-0" />
          <span className="truncate">会话</span>
        </button>
        <NavRow to="/settings" label="设置" icon={Settings2} active={isActive('/settings')} />
        <NavRow to="/appearance" label="外观" icon={Moon} active={isActive('/appearance')} />
      </div>
    </aside>
  )
}
