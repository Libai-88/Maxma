import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import type { CapabilitiesResponse, ToolItem } from '@/types'

interface McpServerItem {
  server_id?: string
  name?: string
  transport?: string
  enabled?: boolean
  status?: string
  [key: string]: unknown
}

function formatValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? '开启' : '关闭'
  if (v === null || v === undefined) return '-'
  return String(v)
}

const categoryLabels: Record<string, string> = {
  file: '文件操作',
  code: '代码',
  web: '网络',
  system: '系统',
  interactive: '交互',
  memory: '记忆',
  skills: '技能',
}

const extensionLabels: Record<string, string> = {
  'maxma-approval': '工具审批',
  'maxma-blocker': '路径拒止锚',
  'request-telemetry': '请求观测',
}

function Section({ title, desc, children }: { title: ReactNode; desc?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-1 text-base font-semibold text-foreground">{title}</h3>
      {desc && <p className="mb-3 text-xs text-muted-foreground">{desc}</p>}
      <div>{children}</div>
    </section>
  )
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-md border border-border bg-panel px-3 py-3 text-center">
      <div className="font-mono text-2xl font-bold tabular-nums text-primary">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

export default function CapabilitiesView() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<CapabilitiesResponse | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await api.getCapabilities()
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const settings = data?.settings ?? {}
  const tools: ToolItem[] = data?.tools ?? []
  const toolCategories = data?.tool_categories ?? {}
  const providers = data?.providers ?? []
  const mcpServers = (data?.mcp_servers ?? []) as McpServerItem[]
  const discoveredMcp = (data?.discovered_mcp ?? null) as McpServerItem[] | null
  const env = data?.env ?? {}
  const system = data?.system ?? {}
  const memory = data?.memory ?? null
  const configSources = data?.config_sources ?? null
  const features = data?.features
  const extensionsEnabled = features?.extensions?.enabled === true
  const extRaw = features?.extensions as Record<string, unknown> | undefined
  const bundledExtensions: string[] = Array.isArray(extRaw?.bundled)
    ? (extRaw?.bundled as unknown[]).filter((n): n is string => typeof n === 'string')
    : []

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col mx-auto w-full max-w-4xl gap-4 p-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">能力清单</h2>
          <p className="mt-1 text-sm text-muted-foreground">Pi Agent 可用工具、接入能力与运行配置</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>加载中...</span>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-destructive">加载失败: {error}</p>
            <Button variant="outline" className="mt-3" onClick={load}>重试</Button>
          </div>
        ) : (
          <>
            <Section title="系统概览">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard value={Number(system.session_count) || 0} label="活跃会话" />
                <StatCard value={tools.length} label="可用工具" />
                <StatCard value={providers.length} label="模型提供商" />
                <StatCard value={mcpServers.length + (discoveredMcp?.length ?? 0)} label="MCP 服务器" />
                <StatCard value={memory?.total ?? 0} label="记忆条数" />
              </div>
              {env.cwd && (
                <div className="mt-3 text-xs">
                  <div className="flex gap-2 py-1">
                    <span className="min-w-20 text-muted-foreground">会话工作目录</span>
                    <span className="break-all font-mono text-foreground">{env.cwd}</span>
                  </div>
                  <div className="flex gap-2 py-1">
                    <span className="min-w-20 text-muted-foreground">平台</span>
                    <span className="break-all font-mono text-foreground">{env.platform}</span>
                  </div>
                </div>
              )}
            </Section>

            <Section title="运行时配置">
              {Object.keys(settings).length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无可用的配置项</p>
              ) : (
                <div className="grid max-h-90 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                  {Object.entries(settings).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-2 rounded-md bg-panel px-2.5 py-1.5 text-xs">
                      <span className="max-w-[55%] truncate font-mono text-muted-foreground">{key}</span>
                      <span className="max-w-[40%] truncate font-medium text-foreground">{formatValue(value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {Object.keys(toolCategories).length > 0 && (
              <Section title={`工具清单 (${tools.length})`}>
                {Object.entries(toolCategories).map(([cat, catTools]) => (
                  <div key={cat} className="mb-3">
                    <h4 className="mb-2 text-sm font-medium text-muted-foreground">{categoryLabels[cat] ?? cat} ({catTools.length})</h4>
                    <div className="flex max-h-60 flex-wrap gap-2 overflow-y-auto">
                      {catTools.map((t) => (
                        <span key={t.name} title={t.description} className="inline-flex items-center rounded-full border border-border bg-panel px-3.5 py-2.5 text-xs text-muted-foreground">
                          {t.label ?? t.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {extensionsEnabled && (
              <Section title="内置扩展" desc="随 Maxma 启用的 Pi 扩展，用于安全控制与运行观测。">
                <div className="flex flex-wrap gap-2">
                  {bundledExtensions.map((name) => (
                    <span key={name} className="rounded-full border border-border bg-panel px-3.5 py-2.5 text-xs text-muted-foreground">
                      {extensionLabels[name] ?? name}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {providers.length > 0 && (
              <Section title={`模型提供商 (${providers.length})`}>
                <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                  {providers.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-md bg-panel px-3 py-2 text-sm">
                      <span className="flex-1 font-medium text-foreground">{p.name ?? p.id}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.model}</span>
                      <span className="rounded-sm bg-card px-2 py-1.5 text-xs text-muted-foreground">{p.provider}</span>
                      <span className={'rounded-sm px-2 py-0.5 text-xs ' + (p.enabled ? 'text-primary' : 'text-muted-foreground')}>
                        {p.enabled ? '启用' : '禁用'}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {(mcpServers.length > 0 || (discoveredMcp?.length ?? 0) > 0) && (
              <Section title="MCP 服务器">
                {mcpServers.length > 0 && (
                  <>
                    <h4 className="mb-2 mt-1 text-sm font-medium text-muted-foreground">已配置</h4>
                    <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                      {mcpServers.map((s, idx) => (
                        <div key={s.server_id ?? idx} className="flex items-center gap-3 rounded-md bg-panel px-3 py-2 text-sm">
                          <span className="flex-1 truncate font-medium text-foreground">{s.name ?? s.server_id}</span>
                          <span className="font-mono text-xs text-muted-foreground">{s.transport ?? 'stdio'}</span>
                          <span className={'text-xs ' + (s.enabled !== false ? 'text-primary' : 'text-muted-foreground')}>
                            {s.enabled !== false ? '启用' : '禁用'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {discoveredMcp && discoveredMcp.length > 0 && (
                  <>
                    <h4 className="mb-2 mt-3 text-sm font-medium text-muted-foreground">自动发现</h4>
                    <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                      {discoveredMcp.map((s, idx) => (
                        <div key={s.name ?? idx} className="flex items-center gap-3 rounded-md bg-panel px-3 py-2 text-sm">
                          <span className="flex-1 truncate font-medium text-foreground">{s.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">{s.transport}</span>
                          <span className="text-xs text-muted-foreground">{s.status}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Section>
            )}

            {configSources && (
              <Section
                title={`配置来源 (${configSources.active_count}/${configSources.total_count} 活跃)`}
                desc="只列出代码里真的有读取方的位置。「存在」指文件/目录在磁盘上，「读取方」是消费它的模块。"
              >
                <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
                  {configSources.sources.map((s) => (
                    <div key={s.name} className={'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs ' + (s.exists ? 'bg-panel' : 'opacity-45')}>
                      <span className="min-w-6 shrink-0 font-mono text-muted-foreground">#{s.priority}</span>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <span className="block truncate font-medium text-foreground">{s.name}</span>
                        <span className="block truncate text-muted-foreground">{s.description}</span>
                        {/* 路径是本页的核心信息：用户要靠它找到/修改文件。
                            不显示路径的话，"存在/未发现"只是一个无法核实的断言。 */}
                        <span className="block truncate font-mono text-[11px] text-muted-foreground/80" title={s.path}>{s.path}</span>
                        {s.reader ? (
                          <span className="block truncate font-mono text-[11px] text-muted-foreground/60">读取方：{s.reader}</span>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-sm bg-card px-2 py-1.5 text-muted-foreground">{s.scope}</span>
                      <span className={'shrink-0 rounded-sm px-2 py-0.5 ' + (s.exists ? 'text-primary' : 'text-muted-foreground')}>
                        {s.exists ? '存在' : '未发现'}
                      </span>
                    </div>
                  ))}
                </div>
                {configSources.conflicts && configSources.conflicts.length > 0 ? (
                  <div className="mt-3">
                    <h4 className="mb-2 text-sm text-muted-foreground">配置覆盖与叠加</h4>
                    {configSources.conflicts.map((c) => (
                      <div key={c.scope} className="mb-2 rounded-lg border border-border bg-panel px-3.5 py-3">
                        <div className="text-xs font-semibold text-foreground">
                          {c.severity === 'warning' ? '⚠️ ' : ''}{c.scope}
                        </div>
                        <div className="mt-1 break-words text-sm text-muted-foreground">{c.sources.join(' ↔ ')}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{c.note}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
