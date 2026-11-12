import { NavLink, useLocation } from 'react-router-dom'
import { MessageSquare, Cpu, Brain, Sparkles, BarChart3, Blocks, Puzzle, Activity, Settings2, PanelLeft, Moon } from 'lucide-react'
import { useCapabilitiesStore } from '@/stores/capabilities'
import { useChatStore } from '@/stores/chat'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface NavItem { to: string; label: string; icon: typeof MessageSquare; feature?: string }
interface NavGroup { key: string; label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'work', label: '工作', items: [
      { to: '/', label: '对话', icon: MessageSquare },
      { to: '/providers', label: '模型', icon: Cpu },
      { to: '/memory', label: '记忆', icon: Brain, feature: 'memory' },
      { to: '/evolution', label: '成长', icon: Sparkles, feature: 'memory' },
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

export function Sidebar({ onToggleSessions }: { onToggleSessions: () => void }) {
  const capabilities = useCapabilitiesStore((s) => s.capabilities)
  const channels = useChatStore((s) => s.channels)
  const version = useChatStore((s) => s.version)
  void version
  const hasStreaming = Array.from(channels.values()).some((c) => c.isStreaming)
  const location = useLocation()

  const hasFeature = (name?: string) => {
    if (!name) return true
    if (!capabilities) return true // 清单未加载时乐观放行，与旧 Dock 一致
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
        <div className="size-6 rounded-md bg-foreground/85" aria-hidden="true" />
        <span className="text-sm font-semibold tracking-wide">Maxma</span>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4" aria-label="页面导航">
        {visibleGroups.map((group) => (
          <div key={group.key} role="group" aria-label={group.label}>
            <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isActive(item.to)
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {item.to === '/' && hasStreaming && <span className="ml-auto size-1.5 animate-pulse rounded-full bg-foreground" aria-label="正在生成" />}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-border px-2 py-3" role="group" aria-label="系统">
        <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">系统</p>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2.5" onClick={onToggleSessions} aria-label="会话列表">
          <PanelLeft className="size-4" /> 会话
        </Button>
        <NavLink to="/settings" className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors', isActive('/settings') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
          <Settings2 className="size-4" /> 设置
        </NavLink>
        <NavLink to="/appearance" className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors', isActive('/appearance') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
          <Moon className="size-4" /> 外观
        </NavLink>
      </div>
    </aside>
  )
}

