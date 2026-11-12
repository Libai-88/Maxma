import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { confirmAction } from '@/components/common/ConfirmDialog'
import { api } from '@/api'
import { createLogger } from '@/utils/logger'
import { toErrorMessage } from '@/utils/error'

const log = createLogger('MemoryView')

interface MemoryFact {
  id: string
  content: string
  category: string
  updatedAt: string
}

interface MemoryStats {
  total: number
  categories: Record<string, number>
}

const PAGE_SIZE = 50

const selectCls =
  'rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-card [&>option]:text-foreground'

function categoryLabel(cat: string): string {
  return cat || '未分类'
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('preference')
  const [stats, setStats] = useState<MemoryStats>({ total: 0, categories: {} })
  const [facts, setFacts] = useState<MemoryFact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const factsSeq = useRef(0)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const filtersRef = useRef({ searchQuery: '', categoryFilter: 'all' })
  filtersRef.current = { searchQuery, categoryFilter }

  const resetPagination = useCallback(() => setVisibleCount(PAGE_SIZE), [])

  const loadFacts = useCallback(
    async (reset = true) => {
      const seq = ++factsSeq.current
      const { searchQuery: q0, categoryFilter: cf } = filtersRef.current
      try {
        const q = q0.trim()
        const cat = cf !== 'all' ? cf : undefined
        const params = new URLSearchParams()
        if (q) params.set('q', q)
        if (cat) params.set('category', cat)
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

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    void (async () => {
      setLoading(true)
      await loadFacts()
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
  }, [loadFacts])

  const debouncedSearch = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      resetPagination()
      void loadFacts()
    }, 300)
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
        <p className="text-sm text-muted-foreground">你明确要求记住的长期事实——偏好、背景、历史决策；由 Agent 调用 remember_memory 或你在此编辑。</p>
      </div>

      {!loading && (
        <div className="flex flex-wrap gap-3">
          <StatCard value={String(stats.total)} label="总条数" />
          {Object.entries(stats.categories ?? {}).map(([cat, count]) => (
            <StatCard key={cat} value={String(count)} label={categoryLabel(cat)} />
          ))}
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
      </div>

      {loading ? (
        <div className="grid gap-3" role="status" aria-live="polite" aria-label="正在加载记忆">
          <span className="sr-only">正在加载记忆…</span>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="grid gap-3 rounded-xl border border-border bg-card p-4">
              <Skeleton className="h-3 w-[88%]" />
              <Skeleton className="h-3 w-[62%]" />
              <Skeleton className="h-2 w-[28%]" />
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
            {!searchQuery ? '记忆只在你明确要求（“记住……”）或 Agent 调用 remember_memory 时写入，不会自行推断。' : '尝试其他搜索词或清除筛选条件。'}
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

