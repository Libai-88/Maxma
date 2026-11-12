import { useCallback, useEffect, useState } from 'react'
import { Globe, Loader2, Download, ShieldCheck } from 'lucide-react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { showToast } from '@/lib/toast'
import type { ModelScopeMcpServer, OAuthStatusResponse, RegistryServer } from '@/types/mcp'

const PAGE_SIZE = 10

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * MCP 市场：Smithery Registry + ModelScope 两个来源，安装后写入本地 MCP 服务器列表；
 * 远程服务器需要 OAuth 时提供「授权」（新窗口打开授权页，随后轮询状态）。
 *
 * 与旧 `McpView.vue` 的市场区块同语义：搜索 → 安装 → 刷新本地列表；
 * OAuth 只对 Registry 条目提供（ModelScope 条目由其自带 env 模板导入）。
 */
export function McpMarket({ onInstalled }: { onInstalled: () => void }) {
  const [source, setSource] = useState<'smithery' | 'modelscope'>('smithery')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Array<RegistryServer | ModelScopeMcpServer>>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [authorizing, setAuthorizing] = useState<string | null>(null)
  const [oauth, setOauth] = useState<Record<string, OAuthStatusResponse>>({})
  const [error, setError] = useState('')

  const load = useCallback(async (src: 'smithery' | 'modelscope', q: string, p: number) => {
    setLoading(true)
    setError('')
    try {
      if (src === 'smithery') {
        const res = await api.getMcpRegistry({ q: q || undefined, page: p, page_size: PAGE_SIZE })
        setItems(res.servers ?? [])
        setTotal(res.total ?? 0)
      } else {
        const res = await api.searchModelScopeMcp({ q: q || undefined, page: p })
        setItems(res.servers ?? [])
        setTotal(res.total ?? 0)
      }
    } catch (e) {
      setItems([]); setTotal(0); setError(errText(e))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load(source, query, page) }, [load, source, page]) // eslint-disable-line react-hooks/exhaustive-deps

  // Registry 列表加载后补查 OAuth 状态（静默失败）
  useEffect(() => {
    if (source !== 'smithery' || items.length === 0) return
    let cancelled = false
    void (async () => {
      const next: Record<string, OAuthStatusResponse> = {}
      for (const it of items as RegistryServer[]) {
        try { next[it.name] = await api.mcpOAuthStatus(it.name) } catch { /* 未授权即无状态 */ }
      }
      if (!cancelled) setOauth(next)
    })()
    return () => { cancelled = true }
  }, [source, items])

  const install = async (item: RegistryServer | ModelScopeMcpServer) => {
    const name = 'display_name' in item ? item.name : item.id
    if (installing) return
    setInstalling(name)
    try {
      if (source === 'smithery') {
        await api.installMcpFromRegistry((item as RegistryServer).name)
        showToast(`已安装 ${(item as RegistryServer).display_name || name}`)
      } else {
        // ModelScope：先读详情，向用户索取必需的 env 模板变量（旧实现同语义）
        const detail = await api.getModelScopeMcpDetail((item as ModelScopeMcpServer).id)
        const env: Record<string, string> = {}
        const root = (detail.server_config as Array<Record<string, unknown>> | undefined)
          ?.find((entry) => entry.mcpServers && typeof entry.mcpServers === 'object')?.mcpServers as Record<string, unknown> | undefined
        const cfg = root && (Object.values(root)[0] as Record<string, unknown> | undefined)
        const srcEnv = cfg?.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env) ? cfg.env as Record<string, unknown> : {}
        for (const [key, raw] of Object.entries(srcEnv)) {
          if (!/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(String(raw ?? ''))) continue
          const value = window.prompt(`请输入必需的 MCP 环境变量：${key}`, '')
          if (value === null) return
          if (!value.trim()) { showToast(`必填环境变量 ${key} 为空，已取消导入`, 'error'); return }
          env[key] = value
        }
        await api.installModelScopeMcp((item as ModelScopeMcpServer).id, env)
        showToast(`已导入 ${(item as ModelScopeMcpServer).name}`)
      }
      onInstalled()
    } catch (e) {
      showToast('安装失败: ' + errText(e), 'error')
    } finally { setInstalling(null) }
  }

  const authorize = async (server: RegistryServer) => {
    if (authorizing) return
    setAuthorizing(server.name)
    try {
      const res = await api.mcpOAuthAuthorize(server.name)
      window.open(res.auth_url, '_blank', 'width=600,height=700')
      showToast('已打开授权页面，请在新窗口中完成授权')
      // 5s 后查一次状态（旧实现同节奏）
      setTimeout(() => {
        void api.mcpOAuthStatus(server.name)
          .then((s) => setOauth((prev) => ({ ...prev, [server.name]: s })))
          .catch(() => { /* 静默 */ })
      }, 5000)
    } catch (e) {
      showToast('授权失败: ' + errText(e), 'error')
    } finally { setAuthorizing(null) }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="glass-panel rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Globe className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">MCP 市场</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant={source === 'smithery' ? 'secondary' : 'ghost'} onClick={() => { setSource('smithery'); setPage(1) }}>Smithery</Button>
          <Button size="xs" variant={source === 'modelscope' ? 'secondary' : 'ghost'} onClick={() => { setSource('modelscope'); setPage(1) }}>ModelScope</Button>
        </div>
      </div>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); setPage(1); void load(source, query, 1) }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={source === 'smithery' ? '搜索 Registry（如 filesystem、github）' : '搜索 ModelScope MCP'}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring"
          aria-label="搜索 MCP 市场"
        />
        <Button size="sm" type="submit" variant="outline" disabled={loading}>
          {loading ? <Loader2 className="size-3 animate-spin" /> : '搜索'}
        </Button>
      </form>

      {error && <p className="mb-2 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive">市场不可用：{error}</p>}

      <div className="flex flex-col gap-2">
        {loading && <div className="flex justify-center py-6"><Spinner /></div>}
        {!loading && items.length === 0 && !error && (
          <p className="py-6 text-center text-xs text-muted-foreground">没有匹配的条目</p>
        )}
        {!loading && (items as Array<RegistryServer | ModelScopeMcpServer>).map((item) => {
          const isRegistry = 'display_name' in item
          const key = isRegistry ? (item as RegistryServer).name : (item as ModelScopeMcpServer).id
          const title = isRegistry ? ((item as RegistryServer).display_name || (item as RegistryServer).name) : (item as ModelScopeMcpServer).name
          const desc = item.description || ''
          const author = item.author || ''
          const status = isRegistry ? oauth[(item as RegistryServer).name] : undefined
          return (
            <div key={key} className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{title}</span>
                {isRegistry && (item as RegistryServer).verified && <Badge variant="secondary" className="text-[10px]">已验证</Badge>}
                {author && <span className="text-[11px] text-muted-foreground">by {author}</span>}
                {status && (
                  <Badge variant={status.authorized ? 'secondary' : 'outline'} className="text-[10px]">
                    <ShieldCheck className="mr-1 size-3" />{status.authorized ? `已授权（${status.status}）` : '未授权'}
                  </Badge>
                )}
                {isRegistry && typeof (item as RegistryServer).downloads === 'number' && (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {((item as RegistryServer).downloads / 1000).toFixed(1)}k 次下载
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{desc}</p>
              <div className="mt-2 flex gap-2">
                <Button size="xs" disabled={installing !== null} onClick={() => void install(item)}>
                  {installing === key ? <Spinner className="size-3" /> : <Download className="size-3" />} 安装
                </Button>
                {isRegistry && (
                  <Button size="xs" variant="outline" disabled={authorizing !== null} onClick={() => void authorize(item as RegistryServer)}>
                    {authorizing === key ? <Spinner className="size-3" /> : null} 授权
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Button size="xs" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <span>{page} / {pages}</span>
          <Button size="xs" variant="outline" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>下一页</Button>
        </div>
      )}
    </div>
  )
}