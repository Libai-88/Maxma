import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useMetricsStore } from '@/stores/metrics'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { LlmUsageCall } from '@/types'
import { cn } from '@/lib/utils'

interface BarItem {
  label: string
  value: number
  display?: string
  kind?: 'default' | 'error'
}

function Stat({ value, label, error }: { value: string | number; label: string; error?: boolean }) {
  return (
    <div className="px-3.5 py-2.5 border border-border rounded-lg bg-background">
      <div className={cn('font-mono tabular-nums text-[22px] font-bold leading-tight', error ? 'text-destructive' : 'text-foreground')}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function BarChart({ items, maxValue, height = 140 }: { items: BarItem[]; maxValue?: number; height?: number }) {
  if (items.length === 0) return <div className="text-muted-foreground text-xs text-center py-3">无数据</div>
  const maxVal = maxValue !== undefined && maxValue > 0 ? maxValue : Math.max(...items.map(i => i.value), 1)
  return (
    <div className="flex flex-col gap-1 overflow-y-auto" style={{ height }}>
      {items.map((item, idx) => {
        const percent = maxVal > 0 ? Math.max(2, (item.value / maxVal) * 100) : 0
        return (
          <div key={`${item.label}-${idx}`} className="flex items-center gap-2 text-xs min-h-[18px]" title={`${item.label}: ${item.value}`}>
            <div className="w-[100px] shrink-0 truncate text-muted-foreground font-mono" title={item.label}>{item.label}</div>
            <div className="flex-1 h-2 bg-secondary rounded overflow-hidden">
              <div className={cn('h-full rounded', item.kind === 'error' ? 'bg-destructive' : 'bg-primary')} style={{ width: `${percent}%` }} />
            </div>
            <div className="w-[60px] shrink-0 text-right text-foreground font-semibold text-[11px] truncate">{item.display ?? String(item.value)}</div>
          </div>
        )
      })}
    </div>
  )
}

function SparkBars({ data, height = 60 }: { data: number[]; height?: number }) {
  if (data.length < 2) return <div className="text-muted-foreground text-xs text-center py-3">无足够数据</div>
  const max = Math.max(...data, 1)
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {data.map((v, i) => (
        <div key={i} className="flex-1 bg-primary rounded-t-sm min-h-[2px]" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} title={String(v)} />
      ))}
    </div>
  )
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1000000).toFixed(2)}M`
}

export default function MetricsView() {
  const { snapshot, history, loading, error, refresh, loadHistory } = useMetricsStore()
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [historyWindow, setHistoryWindow] = useState(3600)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [recentCalls, setRecentCalls] = useState<LlmUsageCall[]>([])
  const [callsLoading, setCallsLoading] = useState(false)
  const [callsError, setCallsError] = useState('')

  async function loadHistoryWith(windowSeconds: number) {
    setHistoryLoading(true)
    try { await loadHistory(windowSeconds) } finally { setHistoryLoading(false) }
  }

  const loadRecentCalls = async () => {
    setCallsLoading(true)
    setCallsError('')
    try {
      const res = await api.getLlmUsage({ windowSeconds: 30 * 24 * 60 * 60 })
      setRecentCalls(res.recent_calls ?? [])
    } catch (e) {
      setCallsError(e instanceof Error ? e.message : String(e))
    } finally {
      setCallsLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    void loadRecentCalls()
    setHistoryLoading(true)
    loadHistory(3600).finally(() => setHistoryLoading(false))
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => { void useMetricsStore.getState().refresh() }, 15000)
    return () => clearInterval(id)
  }, [autoRefresh])

  const statusCodeItems: BarItem[] = snapshot
    ? Object.entries(snapshot.http.status_codes).map(([code, count]) => ({
        label: code,
        value: count,
        kind: code.startsWith('5') ? 'error' : 'default',
      }))
    : []
  const statusCodeMax = statusCodeItems.length > 0 ? Math.max(...statusCodeItems.map(i => i.value)) : 1
  const topPathItems: BarItem[] = snapshot
    ? Object.entries(snapshot.http.top_paths).map(([path, hist]) => ({
        label: path,
        value: hist.count,
        display: `${hist.count} / ${hist.avg_ms.toFixed(0)}ms`,
      }))
    : []
  const toolItems: BarItem[] = snapshot
    ? Object.entries(snapshot.tools.by_tool).map(([name, info]) => ({
        label: name,
        value: info.count,
        display: info.errors ? `${info.count} (err ${info.errors})` : String(info.count),
        kind: info.errors && info.errors > 0 ? 'error' : 'default',
      }))
    : []
  const modelItems: BarItem[] = snapshot
    ? Object.entries(snapshot.llm.by_model).map(([model, count]) => ({ label: model, value: count }))
    : []
  const httpHistorySeries = history ? history.snapshots.map(s => s.http?.total_requests ?? 0) : []
  const toolHistorySeries = history ? history.snapshots.map(s => s.tools?.total_calls ?? 0) : []
  const llmHistorySeries = history ? history.snapshots.map(s => s.llm?.total_tokens_out ?? 0) : []

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold text-foreground">运行指标</h2>
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground flex-wrap">
          {loading ? (
            <span className="px-2 py-0.5 rounded bg-secondary text-muted-foreground text-xs">刷新中…</span>
          ) : error ? (
            <span title={error} className="px-2 py-0.5 rounded bg-destructive/10 text-destructive text-xs">获取失败</span>
          ) : snapshot ? (
            <span className="px-2 py-0.5 rounded bg-secondary text-muted-foreground text-xs">运行 {formatUptime(snapshot.uptime_seconds)}</span>
          ) : null}
          <button onClick={() => void refresh()} className="px-2.5 py-1.5 border border-border rounded-lg bg-card text-muted-foreground text-xs hover:border-ring hover:text-foreground transition-colors">刷新</button>
          <label className="flex items-center gap-1 text-xs cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="cursor-pointer" /> 自动刷新 (15s)
          </label>
        </div>
      </div>

      <details className="mb-4 border border-border rounded-lg bg-card">
        <summary className="px-4 py-3 text-[13px] font-semibold text-foreground cursor-pointer select-none">这些指标是什么？我该关注什么？</summary>
        <div className="px-4 pb-3 text-[12.5px] text-muted-foreground leading-[1.75]">
          <p className="my-1.5">本页展示 Maxma 后端进程的实时运行数据，帮助判断应用是否健康、AI 是否按预期工作。</p>
          <ul className="my-1.5 pl-[22px] list-disc">
            <li><strong className="text-foreground">HTTP 请求</strong>：前端与本地后端通信的请求数与延迟。延迟突然飙高说明后端响应变慢。</li>
            <li><strong className="text-foreground">工具调用</strong>：AI 实际使用的工具次数（搜索、文件读写、MCP 等）。错误数 &gt; 0 提示有工具失败。</li>
            <li><strong className="text-foreground">模型请求</strong>：按每条助手模型响应统计，工具循环中的多次请求分别计数。未返回的用量保持未知，不会用估算值冒充 API 用量。</li>
            <li><strong className="text-foreground">错误统计</strong>：按类别聚合的应用错误。健康状态下应为空或极少。</li>
            <li><strong className="text-foreground">历史趋势</strong>：可切换 30 分钟 ~ 24 小时窗口，观察指标随时间的变化。</li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">想看“AI 在什么时候做了什么”？前往<Link to="/privacy" className="text-link hover:underline">隐私仪表盘</Link>的审计日志区。</p>
        </div>
      </details>

      {!snapshot && loading ? (
        <div className="flex items-center justify-center gap-2 py-4 text-[13px] text-muted-foreground">
          <span className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>加载中…</span>
        </div>
      ) : !snapshot ? (
        <div className="flex items-center justify-center gap-2 py-4 text-[13px] text-muted-foreground">
          <Sparkles className="size-4 text-muted-foreground" />暂无数据
        </div>
      ) : (
        <>
          <section className="mb-4 p-[22px] border border-border rounded-lg bg-card">
            <h3 className="text-[15px] font-semibold text-foreground mb-3">HTTP 请求</h3>
            <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-3">前端发往本地后端的 HTTP 请求总量、延迟分布与状态码构成。延迟飙升或 5xx 占比高，通常意味着后端卡顿或异常。</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 mb-4">
              <Stat value={snapshot.http.total_requests} label="总请求数" />
              <Stat value={snapshot.http.latency_ms.count} label="采样数" />
              <Stat value={`${snapshot.http.latency_ms.avg_ms.toFixed(1)}ms`} label="平均延迟" />
              <Stat value={`${snapshot.http.latency_ms.max_ms.toFixed(1)}ms`} label="最大延迟" />
            </div>
            <div className="mt-3">
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">状态码分布</div>
              <BarChart items={statusCodeItems} maxValue={statusCodeMax} height={80} />
            </div>
            <div className="mt-3">
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Top 路径 (按请求数)</div>
              <BarChart items={topPathItems} height={160} />
            </div>
          </section>

          <section className="mb-4 p-[22px] border border-border rounded-lg bg-card">
            <h3 className="text-[15px] font-semibold text-foreground mb-3">工具调用</h3>
            <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-3">AI 在对话中实际调用的工具（搜索 / 文件读写 / MCP / 内置能力等）的总次数、错误数与按工具的分布。</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 mb-4">
              <Stat value={snapshot.tools.total_calls} label="总调用数" />
              <Stat value={snapshot.tools.total_errors} label="错误总数" error={snapshot.tools.total_errors > 0} />
              <Stat value={Object.keys(snapshot.tools.by_tool).length} label="工具种类" />
            </div>
            <div className="mt-3">
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">工具调用排行</div>
              <BarChart items={toolItems} height={180} />
            </div>
          </section>

          <section className="mb-4 p-[22px] border border-border rounded-lg bg-card">
            <h3 className="text-[15px] font-semibold text-foreground mb-3">模型用量</h3>
            <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-3">按助手模型响应逐次统计。缓存预热单独计数；缓存字段或 usage 缺失时，缓存命中率显示为未知。</p>
            {(snapshot.llm.missing_usage_calls || snapshot.llm.cache_unobserved_calls) ? (
              <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-3">{snapshot.llm.missing_usage_calls || 0} 次请求未返回完整 Token 用量；{snapshot.llm.cache_unobserved_calls || 0} 次请求的缓存字段不可确认，命中率不会把它们当作未命中。</p>
            ) : null}
            {snapshot.llm.cache_warm_calls ? (
              <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-3">缓存预热调用：{snapshot.llm.cache_warm_calls} 次，读取 Token 计入总用量，但不计入对话缓存命中率。</p>
            ) : null}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 mb-4">
              <Stat value={snapshot.llm.total_calls} label="模型请求" />
              <Stat value={formatTokens(snapshot.llm.total_tokens_in)} label="输入 Tokens" />
              <Stat value={formatTokens(snapshot.llm.total_tokens_out)} label="输出 Tokens" />
              <Stat value={formatTokens(snapshot.llm.cache_read_tokens)} label="缓存读取 Tokens（含预热）" />
              <Stat value={snapshot.llm.cache_hit_rate === null ? '—' : `${(snapshot.llm.cache_hit_rate * 100).toFixed(1)}%`} label="缓存命中率" />
              <Stat value={`${snapshot.llm.latency_ms.avg_ms.toFixed(1)}ms`} label="平均轮次时长" />
            </div>
            {Object.keys(snapshot.llm.by_model).length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold text-muted-foreground mb-1.5">按模型统计轮次</div>
                <BarChart items={modelItems} height={100} />
              </div>
            )}
          </section>

          <section className="mb-4 p-[22px] border border-border rounded-lg bg-card">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-[15px] font-semibold text-foreground">最近模型请求</h3>
              <Button variant="outline" size="sm" disabled={callsLoading} onClick={() => void loadRecentCalls()}>
                {callsLoading ? <Spinner className="size-3" /> : null} 刷新
              </Button>
            </div>
            <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-3">
              引擎（pi）逐次上报的用量账本，保留 30 天。预热调用单独成行，不参与命中率计算。
            </p>
            {callsError ? (
              <p className="text-[12.5px] text-destructive">读取失败：{callsError}</p>
            ) : recentCalls.length === 0 ? (
              <div className="text-center py-4 text-[13px] text-muted-foreground">暂无请求记录</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] tabular-nums">
                  <thead>
                    <tr className="text-left text-[11px] text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">时间</th>
                      <th className="py-1 pr-3 font-medium">模型</th>
                      <th className="py-1 pr-3 font-medium text-right">输入</th>
                      <th className="py-1 pr-3 font-medium text-right">输出</th>
                      <th className="py-1 pr-3 font-medium text-right">缓存读</th>
                      <th className="py-1 pr-3 font-medium text-right">耗时</th>
                      <th className="py-1 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentCalls.slice(0, 30).map((c) => (
                      <tr key={c.id} className="border-t border-border/60">
                        <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">{new Date(c.occurred_at).toLocaleTimeString()}</td>
                        <td className="py-1 pr-3 truncate max-w-[22ch]" title={`${c.provider ?? '—'} / ${c.model ?? '—'}`}>{c.model ?? '—'}</td>
                        <td className="py-1 pr-3 text-right">{formatTokens(c.input_tokens ?? 0)}</td>
                        <td className="py-1 pr-3 text-right">{formatTokens(c.output_tokens ?? 0)}</td>
                        <td className="py-1 pr-3 text-right">{c.cache_read_tokens === null ? '—' : formatTokens(c.cache_read_tokens)}</td>
                        <td className="py-1 pr-3 text-right">{c.duration_ms === null ? '—' : c.duration_ms < 1000 ? `${c.duration_ms}ms` : `${(c.duration_ms / 1000).toFixed(1)}s`}</td>
                        <td className="py-1 text-muted-foreground">
                          {c.kind === 'cache_warm' ? '缓存预热' : c.usage_status === 'reported' ? '正常' : c.usage_status === 'partial' ? '用量不全' : '缺用量'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {recentCalls.length > 30 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">仅显示最近 30 条（共 {recentCalls.length} 条）</p>
                )}
              </div>
            )}
          </section>

          <section className="mb-4 p-[22px] border border-border rounded-lg bg-card">
            <h3 className="text-[15px] font-semibold text-foreground mb-3">错误统计</h3>
            <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-3">按类别聚合的应用级错误。健康状态下应该为空或数量极少；某类别突增说明对应子系统可能异常。</p>
            {Object.keys(snapshot.errors).length === 0 ? (
              <div className="text-center py-4 text-[13px] text-muted-foreground">暂无错误</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {Object.entries(snapshot.errors).map(([category, count]) => (
                  <Stat key={category} value={count} label={category} error />
                ))}
              </div>
            )}
          </section>

          <section className="mb-4 p-[22px] border border-border rounded-lg bg-card">
            <h3 className="text-[15px] font-semibold text-foreground mb-3">历史趋势</h3>
            <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-3">按时间窗口采样的历史指标，用于观察趋势（例如请求量高峰、错误突增、Token 消耗累积）。</p>
            <div className="flex gap-2 mb-2 items-center">
              <select
                value={historyWindow}
                onChange={e => { const w = Number(e.target.value); setHistoryWindow(w); void loadHistoryWith(w) }}
                className="px-2 py-1 border border-border rounded-lg bg-background text-foreground text-xs outline-none focus:border-ring"
              >
                <option value={1800}>最近 30 分钟</option>
                <option value={3600}>最近 1 小时</option>
                <option value={21600}>最近 6 小时</option>
                <option value={86400}>最近 24 小时</option>
              </select>
              <button onClick={() => void loadHistoryWith(historyWindow)} className="px-2.5 py-1.5 border border-border rounded-lg bg-card text-muted-foreground text-xs hover:border-ring hover:text-foreground transition-colors">刷新</button>
            </div>
            {historyLoading ? (
              <div className="text-center py-4 text-[13px] text-muted-foreground">历史数据加载中...</div>
            ) : !history || history.snapshots.length < 2 ? (
              <div className="text-center py-4 text-[13px] text-muted-foreground">暂无足够的历史快照</div>
            ) : (
              <>
                <div className="mt-3">
                  <div className="text-xs font-semibold text-muted-foreground mb-1.5">HTTP 请求数 ({history.snapshots.length} 个采样点)</div>
                  <SparkBars data={httpHistorySeries} height={60} />
                </div>
                <div className="mt-3">
                  <div className="text-xs font-semibold text-muted-foreground mb-1.5">工具调用数</div>
                  <SparkBars data={toolHistorySeries} height={60} />
                </div>
                <div className="mt-3">
                  <div className="text-xs font-semibold text-muted-foreground mb-1.5">LLM Tokens (输出)</div>
                  <SparkBars data={llmHistorySeries} height={60} />
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
