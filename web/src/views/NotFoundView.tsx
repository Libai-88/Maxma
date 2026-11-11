import { Link } from 'react-router-dom'
import { MessageCircle, CircleHelp, Palette, MapPin } from 'lucide-react'
import type { ReactNode } from 'react'

interface ActionLinkProps {
  to: string
  icon: ReactNode
  title: string
  desc: string
  primary?: boolean
}

function ActionLink({ to, icon, title, desc, primary }: ActionLinkProps) {
  return (
    <Link
      to={to}
      className={
        'flex items-center gap-3 rounded-lg border p-3 no-underline transition-colors hover:border-primary hover:bg-accent ' +
        (primary ? 'border-primary bg-accent' : 'border-border bg-panel')
      }
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{desc}</span>
      </span>
    </Link>
  )
}

export default function NotFoundView() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-lg">
        <div className="mb-2 text-muted-foreground">
          <MapPin className="mx-auto size-6" />
        </div>
        <h1 className="m-0 text-5xl font-bold tracking-tight text-primary">404</h1>
        <p className="mb-2 mt-1 font-semibold text-foreground">页面不存在或已移动</p>
        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
          你访问的页面可能已被重命名或删除。可以返回对话继续，或前往以下常用页面：
        </p>
        <div className="flex flex-col gap-2 text-left">
          <ActionLink to="/" primary icon={<MessageCircle className="size-4" />} title="返回对话" desc="继续与 AI 聊天" />
          <ActionLink to="/help" icon={<CircleHelp className="size-4" />} title="帮助中心" desc="了解 Maxma 能力与常见问题" />
          <ActionLink to="/appearance" icon={<Palette className="size-4" />} title="外观设置" desc="切换主题、字体与纹理" />
        </div>
      </div>
    </div>
  )
}
