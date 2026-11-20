/**
 * SessionTabs — 对话区顶部的并行会话标签（最多 3 个，P3）。
 *
 * 切 tab 只切 sessionId，不断开旧通道；后台流式输出继续写入各自 channel。
 */

import { useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useChatStore } from '@/stores/chat'
import { useSessionStore } from '@/stores/session'
import { MAX_SESSION_TABS, useSessionTabs } from '@/stores/sessionTabs'
import { cn } from '@/lib/utils'

export function SessionTabs() {
  const navigate = useNavigate()
  const sessionId = useSessionStore((state) => state.sessionId)
  const sessions = useSessionStore((state) => state.sessions)
  const switchSession = useSessionStore((state) => state.switchSession)
  const createSession = useSessionStore((state) => state.createSession)
  const ids = useSessionTabs((state) => state.ids)
  const openTab = useSessionTabs((state) => state.open)
  const closeTab = useSessionTabs((state) => state.close)
  const statuses = useChatStore((state) => state.allSessionStatuses)

  useEffect(() => {
    if (sessionId) openTab(sessionId)
  }, [openTab, sessionId])

  function titleOf(id: string): string {
    const info = sessions.find((session) => session.session_id === id)
    if (info?.name) return info.name
    return `会话 ${id.slice(0, 6)}`
  }

  async function close(id: string) {
    const remaining = ids.filter((item) => item !== id)
    closeTab(id)
    if (id !== sessionId) return
    if (remaining[0]) {
      await switchSession(remaining[0])
    } else {
      await createSession()
      void navigate('/')
    }
  }

  async function add() {
    await createSession()
    void navigate('/')
  }

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-1.5 scrollbar-none" role="tablist" aria-label="并行会话">
      {ids.map((id) => {
        const active = id === sessionId
        const status = statuses[id]
        return (
          <span
            key={id}
            className={cn(
              'flex min-w-0 shrink-0 items-center rounded-md border text-caption',
              active ? 'border-border bg-accent text-foreground' : 'border-transparent text-muted-foreground hover:bg-accent/30',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="flex min-w-0 max-w-44 items-center gap-1.5 px-2 py-1 text-left"
              title={id}
              onClick={() => { if (!active) void switchSession(id) }}
            >
              {status?.isStreaming && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-label="后台输出中" />}
              {!status?.isStreaming && status?.isAwaitingUser && <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-label="等待审批" />}
              <span className="truncate">{titleOf(id)}</span>
              {(status?.unreadEvents ?? 0) > 0 && !active && (
                <span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-micro text-foreground">{status?.unreadEvents}</span>
              )}
            </button>
            <button type="button" className="px-1 py-1 hover:text-foreground" aria-label={`关闭会话 ${titleOf(id)}`} onClick={() => void close(id)}>
              <X className="size-3" />
            </button>
          </span>
        )
      })}
      {ids.length < MAX_SESSION_TABS && (
        <button type="button" className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent/30 hover:text-foreground" onClick={() => void add()}>
          <Plus className="size-3.5" />新会话
        </button>
      )}
    </div>
  )
}
