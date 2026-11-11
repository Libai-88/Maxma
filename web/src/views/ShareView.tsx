import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import { Spinner } from '@/components/ui/spinner'
import { Tag } from '@/components/ui/tag'
import { Markdown } from '@/components/common/Markdown'

interface ShareData {
  share: { access_mode: string; created_at: string; expires_at?: string }
  session_id: string
  messages: { role: string; content: string }[]
}

function shareModeLabel(mode: string): string {
  const labels: Record<string, string> = { read: '只读', comment: '可评论', edit: '可编辑' }
  return labels[mode] || mode
}

function formatDate(dateStr: string): string {
  try { return new Date(dateStr).toLocaleString('zh-CN') } catch { return dateStr }
}

/** 分享的会话（只读视图）。 */
export default function ShareView() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<ShareData | null>(null)
  const shareId = window.location.pathname.split('/').pop() ?? ''

  useEffect(() => {
    void api.request<ShareData>(`/shares/${shareId}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [shareId])

  if (loading) return <div className="flex h-full items-center justify-center"><Spinner /></div>

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h2 className="text-lg font-semibold text-destructive">无法访问分享</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Link to="/" className="text-sm underline">← 返回首页</Link>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="app-scroll mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold">分享的会话</h2>
        <Link to="/" className="text-sm text-muted-foreground underline hover:text-foreground">← 返回</Link>
      </header>
      <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <Tag>{shareModeLabel(data.share.access_mode)}</Tag>
        <span>创建于 {formatDate(data.share.created_at)}</span>
        {data.share.expires_at && <span className="text-status-warn">过期于 {formatDate(data.share.expires_at)}</span>}
      </div>
      <div className="space-y-3">
        {data.messages.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">该会话暂无消息</p>
        )}
        {data.messages.map((msg, idx) => (
          <div key={idx} className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{msg.role === 'user' ? '用户' : 'AI'}</p>
            {msg.role === 'user'
              ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
              : <Markdown content={msg.content} className="text-sm leading-relaxed" />}
          </div>
        ))}
      </div>
    </div>
  )
}
