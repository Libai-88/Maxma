import { useEffect, useState } from 'react'
import { api } from '@/api'
import { useSessionStore } from '@/stores/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tag } from '@/components/ui/tag'
import { confirmAction } from '@/components/common/ConfirmDialog'
import { showToast } from '@/lib/toast'
import { Trash2, Plus } from 'lucide-react'

interface SessionShare {
  id: string
  access_mode: string
  created_at: string
  expires_at?: string
  revoked?: boolean
}
interface SessionSnapshot {
  id: string
  created_at: string
  message_count?: number
}

function formatDate(s: string): string {
  try { return new Date(s).toLocaleString('zh-CN') } catch { return s }
}

/** 协作：会话分享链接与快照管理。 */
export default function CollabView() {
  const sessionId = useSessionStore((s) => s.sessionId)
  const [shares, setShares] = useState<SessionShare[]>([])
  const [snapshots, setSnapshots] = useState<SessionSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [snapshotting, setSnapshotting] = useState(false)

  const load = async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const [shareRes, snapRes] = await Promise.all([
        api.listSessionShares(sessionId).catch(() => ({ shares: [] })),
        api.listSessionSnapshots(sessionId).catch(() => ({ snapshots: [] })),
      ])
      setShares(((shareRes as { shares?: SessionShare[] }).shares ?? []).filter((s) => !s.revoked))
      setSnapshots((snapRes as { snapshots?: SessionSnapshot[] }).snapshots ?? [])
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const createShare = async () => {
    if (!sessionId) return
    setCreating(true)
    try {
      await api.createSessionShare({ session_id: sessionId, access_mode: 'read' })
      showToast('已创建分享链接')
      await load()
    } catch (e) {
      showToast('创建失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setCreating(false) }
  }

  const revokeShare = async (id: string) => {
    if (!await confirmAction({ message: '确定撤销该分享链接？撤销后链接立即失效。', danger: true, confirmText: '撤销' })) return
    try {
      await api.revokeSessionShare(id)
      await load()
    } catch (e) {
      showToast('撤销失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  const createSnapshot = async () => {
    if (!sessionId) return
    setSnapshotting(true)
    try {
      await api.createSessionSnapshot(sessionId, '')
      showToast('已创建快照')
      await load()
    } catch (e) {
      showToast('快照失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setSnapshotting(false) }
  }

  const deleteSnapshot = async (id: string) => {
    if (!await confirmAction({ message: '确定删除该快照？', danger: true, confirmText: '删除' })) return
    try {
      await api.deleteSessionSnapshot(id)
      await load()
    } catch (e) {
      showToast('删除失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  if (!sessionId) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请选择一个会话</div>
  }

  return (
    <div className="app-scroll mx-auto w-full max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h2 className="text-lg font-semibold">协作</h2>
        <p className="mt-1 text-sm text-muted-foreground">管理会话分享、快照与协作访问。</p>
      </header>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium">分享链接</h3>
              <Button size="sm" disabled={creating} onClick={() => void createShare()}>{creating ? <Spinner className="size-3" /> : <Plus />} 创建分享</Button>
            </div>
            <div className="flex flex-col gap-3">
              {shares.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">暂无活跃的分享链接</p>}
              {shares.map((share) => (
                <div key={share.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs">{share.id}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      创建于 {formatDate(share.created_at)}
                      {share.expires_at ? ` · 过期于 ${formatDate(share.expires_at)}` : ''}
                    </p>
                  </div>
                  <Tag>{share.access_mode}</Tag>
                  <Button variant="ghost" size="icon-sm" aria-label="撤销分享" onClick={() => void revokeShare(share.id)}><Trash2 /></Button>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium">快照</h3>
              <Button size="sm" disabled={snapshotting} onClick={() => void createSnapshot()}>{snapshotting ? <Spinner className="size-3" /> : <Plus />} 创建快照</Button>
            </div>
            <div className="flex flex-col gap-3">
              {snapshots.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">暂无快照</p>}
              {snapshots.map((snap) => (
                <div key={snap.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs">{snap.id}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      创建于 {formatDate(snap.created_at)}{typeof snap.message_count === 'number' ? ` · ${snap.message_count} 条消息` : ''}
                    </p>
                  </div>
                  <Input
                    className="hidden"
                    value={`/share/${snap.id}`}
                    readOnly
                    aria-label="快照链接"
                  />
                  <Button variant="ghost" size="icon-sm" aria-label="删除快照" onClick={() => void deleteSnapshot(snap.id)}><Trash2 /></Button>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
