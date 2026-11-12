import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, X, MessageSquare } from 'lucide-react'
import { useSessionStore } from '@/stores/session'
import { useChatStore } from '@/stores/chat'
import { confirmAction } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function SessionDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { sessions, sessionId, createSession, switchSession, deleteSession } = useSessionStore()
  const channels = useChatStore((s) => s.channels)
  const version = useChatStore((s) => s.version)
  void version

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target
      if (t instanceof Element && t.closest('input, [role="menu"]')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleCreate = async () => {
    await createSession()
    onClose()
    navigate('/')
  }
  const handleSwitch = (id: string) => {
    switchSession(id)
    onClose()
    navigate('/')
  }
  const handleDelete = async (id: string) => {
    if (!await confirmAction({ message: '确定删除这个会话？此操作不可撤销。', danger: true, confirmText: '删除' })) return
    await deleteSession(id)
  }

  const statusOf = (id: string) => {
    const ch = channels.get(id)
    if (!ch) return null
    if (ch.isStreaming) return '生成中'
    if (ch.streamPhase === 'awaiting_user') return '等待输入'
    return null
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card/50" aria-label="会话列表">
      <div className="flex h-14 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-medium">会话</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => void handleCreate()} aria-label="新建会话"><Plus /></Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭会话列表"><X /></Button>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {sessions.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">暂无会话</p>}
        {sessions.map((s) => {
          const active = s.session_id === sessionId
          const status = statusOf(s.session_id)
          return (
            <div key={s.session_id} className={cn('group flex items-center gap-1 rounded-lg px-1.5 py-1.5 transition-colors', active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')}>
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => handleSwitch(s.session_id)}>
                <MessageSquare className="size-3.5 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate text-[13px]" title={s.preview || s.session_id}>
                  {s.const_name || s.preview || s.session_id.slice(0, 8)}
                </span>
                {status && <span className="shrink-0 text-[10px] text-muted-foreground">{status}</span>}
              </button>
              <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button variant="ghost" size="icon-sm" onClick={() => void handleDelete(s.session_id)} aria-label="删除会话"><Trash2 /></Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
