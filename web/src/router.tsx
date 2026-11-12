import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useCapabilitiesStore } from '@/stores/capabilities'
import { useOnboardingStore } from '@/stores/onboarding'
import { Spinner } from '@/components/ui/spinner'
import { AppShell } from '@/components/layout/AppShell'
import { QuickChatView } from '@/views/QuickChatView'
import { useAppInit } from '@/hooks/useAppInit'
const V = {
  Chat: lazy(() => import('@/views/ChatView')),
  Memory: lazy(() => import('@/views/MemoryView')),
  Evolution: lazy(() => import('@/views/EvolutionView')),
  News: lazy(() => import('@/views/NewsView')),
  Appearance: lazy(() => import('@/views/AppearanceView')),
  Help: lazy(() => import('@/views/HelpView')),
  Providers: lazy(() => import('@/views/ProvidersView')),
  Soul: lazy(() => import('@/views/SoulView')),
  User: lazy(() => import('@/views/UserView')),
  MaxmaBlocker: lazy(() => import('@/views/MaxmaBlockerView')),
  Privacy: lazy(() => import('@/views/PrivacyView')),
  Metrics: lazy(() => import('@/views/MetricsView')),
  Settings: lazy(() => import('@/views/SettingsView')),
  PluginList: lazy(() => import('@/views/PluginListView')),
  PluginDetail: lazy(() => import('@/views/PluginDetailView')),
  JetHub: lazy(() => import('@/views/JetHubView')),
  Extension: lazy(() => import('@/views/ExtensionView')),
  Capabilities: lazy(() => import('@/views/CapabilitiesView')),
  Activity: lazy(() => import('@/views/ActivityView')),
  Collab: lazy(() => import('@/views/CollabView')),
  Share: lazy(() => import('@/views/ShareView')),
  Rules: lazy(() => import('@/views/RulesView')),
  AgentTasks: lazy(() => import('@/views/AgentTasksView')),
  FeatureUnavailable: lazy(() => import('@/views/FeatureUnavailableView')),
  NotFound: lazy(() => import('@/views/NotFoundView')),
  Onboarding: lazy(() => import('@/views/OnboardingView')),
}

interface RouteDef {
  path: string
  el: React.ReactNode
  title: string
  feature?: string
}

const ROUTES: RouteDef[] = [
  { path: '/', el: <V.Chat />, title: '对话' },
  { path: '/memory', el: <V.Memory />, title: '记忆', feature: 'memory' },
  { path: '/evolution', el: <V.Evolution />, title: '行为偏好', feature: 'memory' },
  { path: '/kb', el: <Navigate to="/memory" replace />, title: '记忆' },
  { path: '/news', el: <V.News />, title: '动态' },
  { path: '/appearance', el: <V.Appearance />, title: '外观' },
  { path: '/help', el: <V.Help />, title: '帮助' },
  { path: '/providers', el: <V.Providers />, title: '模型提供商' },
  { path: '/soul', el: <V.Soul />, title: '角色设定' },
  { path: '/mcp', el: <Navigate to="/extensions?tab=mcp" replace />, title: '扩展管理' },
  { path: '/user', el: <V.User />, title: '用户' },
  { path: '/maxma-blocker', el: <V.MaxmaBlocker />, title: 'Maxma 阻止' },
  { path: '/privacy', el: <V.Privacy />, title: '隐私' },
  { path: '/metrics', el: <V.Metrics />, title: '指标' },
  { path: '/settings', el: <V.Settings />, title: '设置' },
  { path: '/plugins', el: <V.PluginList />, title: '插件', feature: 'plugins' },
  { path: '/plugins/:name/jet-hub', el: <V.JetHub />, title: 'Jet Hub', feature: 'plugins' },
  { path: '/plugins/:name', el: <V.PluginDetail />, title: '插件详情', feature: 'plugins' },
  { path: '/extensions', el: <V.Extension />, title: '扩展管理' },
  { path: '/audit-log', el: <Navigate to="/privacy" replace />, title: '隐私' },
  { path: '/capabilities', el: <V.Capabilities />, title: '能力仪表盘' },
  { path: '/activity', el: <V.Activity />, title: '活动' },
  { path: '/collab', el: <V.Collab />, title: '协作', feature: 'collab' },
  { path: '/share/:id', el: <V.Share />, title: '分享的会话' },
  { path: '/rules', el: <V.Rules />, title: '质量规则', feature: 'rules' },
  { path: '/automation', el: <V.FeatureUnavailable />, title: '自动化', feature: 'automation' },
  { path: '/agent-tasks', el: <V.AgentTasks />, title: 'Agent 任务中心', feature: 'sub_agents' },
  { path: '/agent-demo', el: <Navigate to="/agent-tasks" replace />, title: 'Agent 任务中心' },
  { path: '/feature-unavailable', el: <V.FeatureUnavailable />, title: '功能不可用' },
]

/** 能力守卫：清单未加载先等一次 fetch；后端不可达时乐观放行，不阻塞页面。 */
function FeatureGate({ feature, children }: { feature?: string; children: React.ReactNode }) {
  const capabilities = useCapabilitiesStore((s) => s.capabilities)
  const fetchCapabilities = useCapabilitiesStore((s) => s.fetchCapabilities)

  useEffect(() => {
    if (!capabilities) void fetchCapabilities().catch(() => {})
  }, [capabilities, fetchCapabilities])

  if (!feature) return <>{children}</>
  if (!capabilities) return <div className="flex h-full items-center justify-center"><Spinner /></div>

  const cfg = capabilities.features?.[feature]
  const unavailable = cfg && (cfg.enabled === false || cfg.engine_supported === false)
  if (unavailable) {
    return <Navigate to={`/feature-unavailable?feature=${encodeURIComponent(feature)}&reason=${encodeURIComponent(String(cfg.reason ?? ''))}`} replace />
  }
  return <>{children}</>
}

function RouteFrame({ def }: { def: RouteDef }) {
  const location = useLocation()
  useEffect(() => {
    document.title = def.title ? `${def.title} - Maxma` : 'Maxma'
  }, [def.title, location.pathname])
  return (
    <div className="app-scroll animate-in fade-in duration-200">
      <FeatureGate feature={def.feature}>{def.el}</FeatureGate>
    </div>
  )
}

function AppRoutes() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner /></div>}>
      <Routes>
        {ROUTES.map((def) => (
          <Route key={def.path} path={def.path} element={<RouteFrame def={def} />} />
        ))}
        <Route path="*" element={<V.NotFound />} />
      </Routes>
    </Suspense>
  )
}

export function App() {
  useAppInit()
  return (
    <BrowserRouter>
      <AppShell>
        <AppRoutes />
      </AppShell>
      <OnboardingOverlay />
    </BrowserRouter>
  )
}

function OnboardingOverlay() {
  const initialized = useOnboardingStore((s) => s.initialized)
  const completed = useOnboardingStore((s) => s.snapshot?.completed)
  if (!initialized || completed) return null
  return <Suspense fallback={null}><V.Onboarding /></Suspense>
}

/** Quick Chat 独立入口，与主应用共享 store/主题/API。 */
export function QuickChatApp() {
  useAppInit()
  return <QuickChatView />
}
