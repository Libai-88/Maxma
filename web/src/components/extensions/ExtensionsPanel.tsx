import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Puzzle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { confirmAction } from '@/components/common/ConfirmDialog'
import { api } from '@/api'

/**
 * 扩展面板（EXT-VISIBLE-001 / EXT-TOGGLE-001）。
 *
 * 使命对齐的依据：pi 的扩展是"能力"的一部分，Maxma 作为展示层必须让它们
 * **看得见、控得住**。此前后端把官方 `extensionsResult` 丢掉，界面既看不到
 * 用户自装扩展，也看不到加载失败——沉默比报错更危险，所以这里优先展示错误。
 *
 * 安全文案与后端 `/api/extensions` 返回的 notes 同源，避免两处各写一套。
 */

interface ExtensionInfo {
  id: string
  name: string
  path: string
  scope: 'user' | 'inline' | 'builtin' | 'other'
  enabled: boolean
  disablable: boolean
  hidden: boolean
}

interface ExtensionsPayload {
  agent_dir: string
  extensions_dir: string
  loaded: boolean
  loaded_at: number | null
  probe: boolean
  extensions: ExtensionInfo[]
  errors: Array<{ path: string; error: string }>
  warnings: Array<{ path: string; warning: string }>
  disabled: string[]
  protected_bundled: string[]
  notes: string[]
}

const SCOPE_LABEL: Record<ExtensionInfo['scope'], string> = {
  user: '用户扩展',
  inline: 'Maxma 内置',
  builtin: 'pi 内置',
  other: '其他来源',
}

export function ExtensionsPanel() {
  const [data, setData] = useState<ExtensionsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await api.request<ExtensionsPayload>('/extensions')
      setData(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 显式重新探测：不建会话，只走一次资源加载，把用户扩展的真实错误暴露出来。 */
  async function refresh() {
    setBusyId('__refresh__')
    setError('')
    try {
      const payload = await api.request<ExtensionsPayload>('/extensions/refresh', { method: 'POST' })
      setData(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId('')
    }
  }

  async function toggleExtension(info: ExtensionInfo) {
    const action = info.enabled ? '禁用' : '启用'
    const ok = await confirmAction({
      message:
        `确认${action}扩展「${info.name}」？\n\n` +
        '扩展以与本会话相同的系统权限运行，请确认来源可信。' +
        `${action}只影响之后新建的会话，当前会话保持创建时的扩展集合。`,
    })
    if (!ok) return
    setBusyId(info.id)
    setError('')
    try {
      const payload = await api.request<ExtensionsPayload>('/extensions', {
        method: 'PUT',
        body: JSON.stringify({ id: info.id, enabled: !info.enabled }),
      })
      setData(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId('')
    }
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="py-3">
        <span className="sr-only">正在读取扩展清单…</span>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, n) => (
            <div key={n} className="grid gap-2 rounded-lg border border-border bg-card p-4">
              <span className="block h-2.5 w-[52%] rounded-full bg-muted" />
              <span className="block h-2.5 w-[82%] rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="glass-panel flex flex-col items-center rounded-lg border border-border px-4 py-10 text-center">
        <div className="mb-3 text-destructive">
          <AlertTriangle className="size-7" />
        </div>
        <div className="mb-1 text-base font-semibold text-foreground">扩展清单暂时不可用</div>
        <p className="mb-4 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => void load()}>
          重试
        </Button>
      </div>
    )
  }

  const extensions = data?.extensions ?? []
  const userCount = extensions.filter((e) => e.scope === 'user').length
  const errorCount = data?.errors.length ?? 0

  return (
    <div className="pb-6">
      {/* 加载错误优先展示：沉默比报错更危险 */}
      {errorCount > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4" />
            {errorCount} 个扩展加载失败（它们不会参与会话）
          </div>
          <div className="flex flex-col gap-2">
            {data!.errors.map((e) => (
              <div key={e.path} className="rounded-md border border-border bg-card p-3">
                <div className="break-all text-xs text-muted-foreground">{e.path}</div>
                <div className="mt-1 break-words text-sm text-foreground">{e.error}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && data && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {data && !data.loaded && (
        <div className="mb-4 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          还没有加载记录：本进程尚未创建过会话。新建一个对话，或点下方「重新探测」，
          这里会显示 pi 真实加载到的扩展。
        </div>
      )}

      {data && data.loaded && data.probe && (
        <div className="mb-4 text-xs text-muted-foreground">
          以下为「重新探测」结果（只装配拒止锚 + 用户扩展，不含审批/遥测/MCP）；
          时间 {data.loaded_at ? new Date(data.loaded_at).toLocaleString() : '未知'}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SectionTitle>扩展 ({extensions.length})</SectionTitle>
        <span className="text-xs text-muted-foreground">
          用户扩展 {userCount} · 可禁用 {extensions.filter((e) => e.disablable).length}
        </span>
        <Button variant="outline" disabled={busyId === '__refresh__'} onClick={() => void refresh()}>
          <RefreshCw className={cn('mr-1 size-4', busyId === '__refresh__' && 'animate-spin')} />
          {busyId === '__refresh__' ? '探测中…' : '重新探测'}
        </Button>
      </div>

      {extensions.length === 0 ? (
        <div className="glass-panel flex flex-col items-center rounded-lg border border-border px-4 py-10 text-center">
          <div className="mb-3 text-muted-foreground">
            <Puzzle className="size-7" />
          </div>
          <div className="mb-1 text-base font-semibold text-foreground">未发现任何扩展</div>
          <p className="mb-2 text-sm text-muted-foreground">
            把扩展文件放进下面的目录，pi 会在下次会话创建时自动加载：
          </p>
          <code className="break-all rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground">
            {data?.extensions_dir ?? '~/.pi/agent/extensions'}
          </code>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {extensions.map((ext) => (
            <div
              key={ext.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{ext.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {SCOPE_LABEL[ext.scope]}
                  </Badge>
                  <Badge variant={ext.enabled ? 'default' : 'outline'} className="text-xs">
                    {ext.enabled ? '已启用' : '已禁用'}
                  </Badge>
                </div>
                <div className="mt-1 break-all text-xs text-muted-foreground">{ext.path}</div>
              </div>
              {ext.disablable ? (
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={busyId === ext.id}
                  onClick={() => void toggleExtension(ext)}
                >
                  {busyId === ext.id ? '处理中…' : ext.enabled ? '禁用' : '启用'}
                </Button>
              ) : (
                <Badge variant="outline" className="shrink-0 text-xs">
                  不可禁用
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {(data?.warnings.length ?? 0) > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 text-sm font-semibold text-foreground">警告</div>
          {data!.warnings.map((w) => (
            <div key={w.path} className="mb-2 text-xs text-muted-foreground">
              <div className="break-all">{w.path}</div>
              <div className="text-foreground">{w.warning}</div>
            </div>
          ))}
        </div>
      )}

      {/* 安全边界说明（与后端 notes 同源） */}
      <div className="mt-6 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
        {(data?.notes ?? []).map((note) => (
          <div key={note} className="mb-1 leading-5">
            · {note}
          </div>
        ))}
        <div className="mt-2 break-all">扩展目录：{data?.extensions_dir ?? '~/.pi/agent/extensions'}</div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-foreground">{children}</h3>
}
