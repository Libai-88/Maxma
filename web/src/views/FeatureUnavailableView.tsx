import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MessageCircle, LayoutDashboard, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCapabilitiesStore, describeFeatureAvailability } from '@/stores/capabilities'

interface ActionProps {
  icon: ReactNode
  title: string
  desc: string
}

function ActionShell({ icon, title, desc }: ActionProps) {
  return (
    <>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{desc}</span>
      </span>
    </>
  )
}

export default function FeatureUnavailableView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const capabilities = useCapabilitiesStore((s) => s.capabilities)
  const isFeatureEnabled = useCapabilitiesStore((s) => s.isFeatureEnabled)
  const refreshCapabilities = useCapabilitiesStore((s) => s.refreshCapabilities)

  // query 值收敛成字符串：URLSearchParams.get 天然取首个、缺项返回 null。
  const featureTitle = searchParams.get('title') ?? ''
  const featureKey = searchParams.get('feature') ?? ''

  // CAP-HONESTY-001：真实原因取自能力清单（engine_supported / reason），
  // 不再靠 route.query 猜「用户可能关掉了」。清单未加载时也只说「无法判断」。
  const availability = describeFeatureAvailability(
    capabilities?.features ?? null,
    featureKey,
  ) as { kind: string; reason: string }

  const availabilityIcon =
    availability.kind === 'engine_unsupported' ? '🚫' :
    availability.kind === 'user_disabled' ? '🔌' : '🚧'

  // 重新拉取能力清单；若该特性其实已启用，则返回原页面。
  async function retry() {
    await refreshCapabilities()
    if (featureKey && isFeatureEnabled(featureKey)) {
      const to = searchParams.get('from')
      if (to) {
        navigate(to, { replace: true })
        return
      }
    }
    navigate('/', { replace: true })
  }

  const actionCls =
    'flex w-full items-center gap-3 rounded-lg border p-3 no-underline transition-colors hover:border-primary hover:bg-accent cursor-pointer'

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-lg">
        <div className="mb-2 text-3xl leading-none">{availabilityIcon}</div>
        <h1 className="m-0 text-2xl font-bold tracking-tight text-primary">功能不可用</h1>
        <p className="mb-2 mt-2 font-semibold text-foreground">
          {featureTitle ? `「${featureTitle}」` : '该功能'}当前未启用。
        </p>
        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
          {availability.reason}
        </p>
        {availability.kind === 'engine_unsupported' && (
          <p className="mb-5 rounded-lg border border-border bg-panel p-3 text-left text-xs leading-relaxed text-muted-foreground">
            这一条由 Agent 引擎的能力清单报告，调整本地设置不会改变结果；引擎支持后重新检测即可恢复入口。
          </p>
        )}
        {availability.kind === 'user_disabled' && (
          <p className="mb-5 rounded-lg border border-border bg-panel p-3 text-left text-xs leading-relaxed text-muted-foreground">
            前往「运行设置」或能力仪表盘可以重新开启。
          </p>
        )}
        <div className="flex flex-col gap-2 text-left">
          <Link to="/" className={actionCls + ' border-primary bg-accent'}>
            <ActionShell icon={<MessageCircle className="size-4" />} title="返回对话" desc="继续与 AI 聊天" />
          </Link>
          <Link to="/capabilities" className={actionCls + ' border-border bg-panel'}>
            <ActionShell icon={<LayoutDashboard className="size-4" />} title="能力仪表盘" desc="查看当前启用的特性" />
          </Link>
          <button type="button" className={actionCls + ' border-border bg-panel'} onClick={retry}>
            <ActionShell icon={<RefreshCw className="size-4" />} title="重新检测" desc="刷新能力清单后返回" />
          </button>
        </div>
      </div>
    </div>
  )
}
