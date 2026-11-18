import { useSessionStore } from '@/stores/session'
import { Tag } from '@/components/ui/tag'

/**
 * 对话页头：会话标题 + 右侧操作插槽（工作台开关、更多菜单）。
 *
 * 标题有三档来源，越靠前越"人话"：
 *   1. 用户设的名字（`PUT /api/sessions/:id/name`，存在会话文件里）；
 *   2. 首条用户消息（后端算好的 `preview`，≤60 字）；
 *   3. 还没聊过的会话叫 `新会话`；已经有内容却依然没名字的，才退回 `会话 <id 前 8 位>`。
 * 以前这里只认 `const_name`，于是每个普通会话的标题都是一串 id。
 */
export function ChatHeader({ children }: { children?: React.ReactNode }) {
  const sessions = useSessionStore((s) => s.sessions)
  const sessionId = useSessionStore((s) => s.sessionId)
  const current = sessions.find((s) => s.session_id === sessionId)
  const fallback = !sessionId || (current && (current.message_count ?? 0) === 0)
    ? '新会话'
    : `会话 ${sessionId.slice(0, 8)}`
  const title = current?.name?.trim() || current?.const_name || current?.preview?.trim() || fallback

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="truncate text-body font-medium">{title}</h1>
        {current?.is_const && <Tag>固定</Tag>}
      </div>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </header>
  )
}
