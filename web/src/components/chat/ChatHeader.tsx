import { useSessionStore } from '@/stores/session'
import { Tag } from '@/components/ui/tag'

/** 对话页头：会话标题 + 右侧操作插槽（工作台开关、更多菜单）。 */
export function ChatHeader({ children }: { children?: React.ReactNode }) {
  const sessions = useSessionStore((s) => s.sessions)
  const sessionId = useSessionStore((s) => s.sessionId)
  const current = sessions.find((s) => s.session_id === sessionId)
  const title = current?.const_name || (sessionId ? `会话 ${sessionId.slice(0, 8)}` : '新会话')

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {current?.is_const && <Tag>固定</Tag>}
      </div>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </header>
  )
}
