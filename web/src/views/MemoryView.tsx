import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api, type HindsightConfig } from '@/api'
import { createLogger } from '@/utils/logger'
import { toErrorMessage } from '@/utils/error'
import { cn } from '@/lib/utils'

const log = createLogger('MemoryView')

interface MemoryFact {
  id: string
  content: string
  category: string
  confidence: number
  updatedAt: string
}

interface MemoryStats {
  total: number
  categories: Record<string, number>
  avg_confidence: number
}

const PAGE_SIZE = 50

const defaultHindsight: HindsightConfig = {
  enabled: false,
  retention_days: 90,
  importance_threshold: 0.5,
  processing_mode: 'auto',
  prompt_template: '',
}

const selectCls =
  'rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-card [&>option]:text-foreground'

interface ConfirmOpts {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

function confirmAction(opts: ConfirmOpts | string): Promise<boolean> {
  const o = typeof opts === 'string' ? { message: opts } : opts
  const text = o.title ? `${o.title}\n\n${o.message}` : o.message
  return Promise.resolve(window.confirm(text))
}

function categoryLabel(cat: string): string {
  return cat || '未分类'
}

function confidenceLevel(c: number): string {
  if (c >= 0.8) return 'high'
  if (c >= 0.5) return 'mid'
  return 'low'
}

function formatTime(t: string): string {
  if (!t) return ''
  try {
    return new Date(t).toLocaleDateString('zh-CN')
  } catch {
    return t
  }
}

export default function MemoryView() {
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [confidenceFilter, setConfidenceFilter] = useState('0')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('preference')
  const [stats, setStats] = useState<MemoryStats>({ total: 0, categories: {}, avg_confidence: 0 })
  const [hindsight, setHindsightState] = useState<HindsightConfig>(defaultHindsight)
  const [hindsightOpen, setHindsightOpen] = useState(false)
  const [facts, setFacts] = useState<MemoryFact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const factsSeq = useRef(0)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const filtersRef = useRef({ searchQuery: '', categoryFilter: 'all', confidenceFilter: '0' })
  filtersRef.current = { searchQuery, categoryFilter, confidenceFilter }

  const resetPagination = useCallback(() => setVisibleCount(PAGE_SIZE), [])

  const loadFacts = useCallback(
    async (reset = true) => {
      const seq = ++factsSeq.current
      const { searchQuery: q0, categoryFilter: cf, confidenceFilter: conf } = filtersRef.current
      try {
        const q = q0.trim()
        const cat = cf !== 'all' ? cf : undefined
        const mc = conf !== '0' ? parseFloat(conf) : undefined
        const params = new URLSearchParams()
        if (q) params.set('q', q)
        if (cat) params.set('category', cat)
        if (mc) params.set('min_confidence', String(mc))
        const qs = params.toString()
        const data = await api.request<MemoryFact[]>(`/memory${qs ? '?' + qs : ''}`)
        if (seq !== factsSeq.current || !mountedRef.current) return
        setFacts(Array.isArray(data) ? data : [])
        if (reset) resetPagination()
        setLoadError('')
      } catch (e) {
        if (seq !== factsSeq.current || !mountedRef.current) return
        setLoadError(toErrorMessage(e))
      }
      try {
        const statsData = await api.request<MemoryStats>('/memory/stats')
        if (seq === factsSeq.current && mountedRef.current) setStats(statsData)
      } catch {
        /* ignore */
      }
    },
    [resetPagination],
  )

  const loadHindsightConfig = useCallback(async () => {
    try {
      const cfg = await api.getHindsightConfig()
      if (mountedRef.current) setHindsightState((h) => ({ ...h, ...cfg }))
    } catch (e) {
      log.warn('[memory] load hindsight config failed:', e)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    void (async () => {
      setLoading(true)
      await Promise.all([loadFacts(), loadHindsightConfig()])
      if (cancelled || !mountedRef.current) return
      setLoading(false)
      refreshTimer.current = setInterval(() => {
        if (!document.hidden) void loadFacts(false)
      }, 15000)
    })()
    return () => {
      cancelled = true
      mountedRef.current = false
      if (refreshTimer.current) window.clearInterval(refreshTimer.current)
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [loadFacts, loadHindsightConfig])

  const debouncedSearch = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      resetPagination()
      void loadFacts()
    }, 300)
  }

  async function setHindsight<K extends keyof HindsightConfig>(key: K, value: HindsightConfig[K]) {
    const prev = hindsight[key]
    setHindsightState((h) => ({ ...h, [key]: value }) as HindsightConfig)
    try {
      const patch = { [key]: value } as unknown as Partial<HindsightConfig>
      const updated = await api.updateHindsightConfig(patch)
      setHindsightState((h) => ({ ...h, ...updated }))
    } catch (e) {
      log.warn(`[memory] set hindsight.${String(key)} failed:`, e)
      setHindsightState((h) => ({ ...h, [key]: prev }) as HindsightConfig)
    }
  }

  const categoryOptions = useMemo(() => {
    const cats = new Set<string>(Object.keys(stats.categories ?? {}))
    for (const f of facts) if (f.category) cats.add(f.category)
    return [...cats].sort()
  }, [stats.categories, facts])

  const displayFacts = useMemo(() => facts.slice(0, visibleCount), [facts, visibleCount])

  const startEdit = (fact: MemoryFact) => {
    setEditingId(fact.id)
    setEditContent(fact.content)
    setEditCategory(fact.category)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent('')
    setEditCategory('preference')
  }

  const saveEdit = async (id: string) => {
    try {
      await api.request(`/memory/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editContent, category: editCategory }),
      })
      setEditingId(null)
      await loadFacts(false)
      toast.success('记忆已更新')
    } catch (e) {
      log.warn('[memory] saveEdit failed:', e)
      toast.error('记忆保存失败: ' + toErrorMessage(e))
    }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirmAction({ title: '删除记忆', message: '确定删除此记忆？', confirmText: '删除', danger: true }))) return
    try {
      await api.request(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await loadFacts(false)
      toast.success('记忆已删除')
    } catch (e) {
      log.warn('[memory] delete failed:', e)
      toast.error('记忆删除失败: ' + toErrorMessage(e))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-foreground">记忆</h2>
        <p className="text-sm text-muted-foreground">AI 自动记录的长期事实——偏好、背景、历史决策。</p>
      </div>

      {!loading && (
        <div className="flex flex-wrap gap-3">
          <StatCard value={String(stats.total)} label="总条数" />
          <StatCard value={stats.avg_confidence != null ? stats.avg_confidence.toFixed(2) : '-'} label="平均置信度" />
          {Object.entries(stats.categories ?? {}).map(([cat, count]) => (
            <StatCard key={cat} value={String(count)} label={categoryLabel(cat)} />
          ))}
        </div>
      )}

      {!loading && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <button
            type="button"
            onClick={() => setHindsightOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-foreground">
              Hindsight 配置
              <span className="ml-2 inline-block rounded-full border border-border bg-secondary px-3 py-1.5 align-middle text-xs font-medium text-muted-foreground">
                即将上线
              </span>
            </span>
            <span className="text-xs text-muted-foreground">{hindsight.enabled ? '已启用' : '已停用'}</span>
            <span className="ml-auto text-xs text-muted-foreground">{hindsightOpen ? '▾' : '▸'}</span>
          </button>
          {hindsightOpen && (
            <div className="border-t border-border px-4 pb-3 pt-2">
              <p className="mb-2 text-xs text-muted-foreground">此功能尚未接入运行时，以下设置暂不生效。</p>
              <HindsightRow label="启用 Hindsight 记忆处理" desc="对历史对话进行回顾，提炼并巩固长期记忆。">
                <button
                  type="button"
                  onClick={() => void setHindsight('enabled', !hindsight.enabled)}
                  className={cn(
                    'rounded-lg border border-border px-3.5 py-2 text-sm',
                    hindsight.enabled ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground',
                  )}
                >
                  {hindsight.enabled ? '开启' : '关闭'}
                </button>
              </HindsightRow>
              <HindsightRow label="保留天数" desc="参与回顾处理的对话时间窗口。">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={7}
                    max={365}
                    step={1}
                    value={hindsight.retention_days}
                    onChange={(e) => void setHindsight('retention_days', Number(e.target.value))}
                    className="w-32"
                  />
                  <span className="min-w-[44px] text-right text-sm text-muted-foreground">{hindsight.retention_days}天</span>
                </div>
              </HindsightRow>
              <HindsightRow label="重要性阈值" desc="仅固化重要度达到此阈值的记忆。">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={hindsight.importance_threshold}
                    onChange={(e) => void setHindsight('importance_threshold', Number(e.target.value))}
                    className="w-32"
                  />
                  <span className="min-w-[44px] text-right text-sm text-muted-foreground">
                    {hindsight.importance_threshold.toFixed(2)}
                  </span>
                </div>
              </HindsightRow>
              <HindsightRow label="处理模式" desc="选择 Hindsight 的触发方式。">
                <select
                  value={hindsight.processing_mode}
                  className={selectCls}
                  onChange={(e) => void setHindsight('processing_mode', e.target.value as HindsightConfig['processing_mode'])}
                >
                  <option value="auto">自动</option>
                  <option value="manual">手动</option>
                  <option value="scheduled">定时</option>
                </select>
              </HindsightRow>
              <div className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
                <div>
                  <div className="text-sm font-medium text-foreground">自定义提示词模板</div>
                  <div className="text-xs text-muted-foreground">留空则使用内置模板。</div>
                </div>
                <Textarea
                  rows={4}
                  value={hindsight.prompt_template}
                  placeholder="回顾以下对话，提取值得长期保留的事实……"
                  onChange={(e) => setHindsightState((h) => ({ ...h, prompt_template: e.target.value }))}
                  onBlur={(e) => void setHindsight('prompt_template', e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={searchQuery}
          placeholder="搜索记忆内容..."
          className="min-w-[160px] flex-1 rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          onChange={(e) => {
            setSearchQuery(e.target.value)
            filtersRef.current.searchQuery = e.target.value
            debouncedSearch()
          }}
        />
        <select
          value={categoryFilter}
          className={selectCls}
          onChange={(e) => {
            setCategoryFilter(e.target.value)
            filtersRef.current.categoryFilter = e.target.value
            void loadFacts(true)
          }}
        >
          <option value="all">全部分类</option>
          {categoryOptions.map((cat) => (
            <option key={cat} value={cat}>
              {categoryLabel(cat)}
            </option>
          ))}
        </select>
        <select
          value={confidenceFilter}
          className={selectCls}
          onChange={(e) => {
            setConfidenceFilter(e.target.value)
            filtersRef.current.confidenceFilter = e.target.value
            void loadFacts(true)
          }}
        >
          <option value="0">全部置信度</option>
          <option value="0.5">50% 以上</option>
          <option value="0.8">80% 以上</option>
        </select>
      </div>

      {loading ? (
        <div className="grid gap-3" role="status" aria-live="polite" aria-label="正在加载记忆">
          <span className="sr-only">正在加载记忆…</span>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="grid gap-3 rounded-xl border border-border bg-card p-4">
              <div className="h-3 w-[88%] animate-pulse rounded bg-muted" />
              <div className="h-3 w-[62%] animate-pulse rounded bg-muted" />
              <div className="h-2 w-[28%] animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <div className="font-semibold text-destructive">加载失败</div>
          <div className="mt-1 text-sm text-muted-foreground">{loadError}</div>
          <Button className="mt-3" onClick={() => void loadFacts(true)}>
            重试
          </Button>
        </div>
      ) : facts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground" />
          <div className="font-semibold text-foreground">{searchQuery ? '未匹配到记忆' : '暂无记忆数据'}</div>
          <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {!searchQuery ? '与 AI 对话后，OMP 会自动记录有价值的事实。' : '尝试其他搜索词或清除筛选条件。'}
            <Link to="/" className="mt-2 block text-foreground hover:underline">
              → 返回对话
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="flex max-h-[600px] flex-col gap-3 overflow-y-auto">
            {displayFacts.map((fact) => (
              <div
                key={fact.id}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-ring"
              >
                {editingId === fact.id ? (
                  <div className="flex flex-col gap-2">
                    <Textarea rows={3} value={editContent} onChange={(e) => setEditContent(e.target.value)} />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={editCategory}
                        className={selectCls}
                        onChange={(e) => setEditCategory(e.target.value)}
                      >
                        {categoryOptions.map((cat) => (
                          <option key={cat} value={cat}>
                            {categoryLabel(cat)}
                          </option>
                        ))}
                      </select>
                      <Button onClick={() => void saveEdit(fact.id)}>保存</Button>
                      <Button variant="outline" onClick={cancelEdit}>
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="cursor-pointer break-words text-sm leading-relaxed text-foreground hover:opacity-80"
                      onDoubleClick={() => startEdit(fact)}
                    >
                      {fact.content}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Badge variant="secondary">{categoryLabel(fact.category)}</Badge>
                      <span
                        className={cn(
                          'rounded-md bg-secondary px-2 py-1 text-xs',
                          confidenceLevel(fact.confidence) === 'high' && 'text-success',
                          confidenceLevel(fact.confidence) === 'mid' && 'text-foreground',
                          confidenceLevel(fact.confidence) === 'low' && 'text-muted-foreground',
                        )}
                      >
                        {(fact.confidence * 100).toFixed(0)}% 把握
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">{formatTime(fact.updatedAt)}</span>
                      <button
                        type="button"
                        title="编辑"
                        onClick={() => startEdit(fact)}
                        className="rounded-md px-1.5 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="删除"
                        onClick={() => void handleDelete(fact.id)}
                        className="rounded-md px-1.5 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-destructive"
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {displayFacts.length < facts.length && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                加载更多（{facts.length - displayFacts.length} 条）
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-[80px] flex-1 rounded-xl border border-border bg-card px-3 py-3 text-center">
      <div className="font-mono text-xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function HindsightRow({ label, desc, children }: { label: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
      </div>
      {children}
    </div>
  )
}
