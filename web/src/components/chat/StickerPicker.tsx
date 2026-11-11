import { useEffect, useMemo, useState } from 'react'
import { request } from '@/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Star, X } from 'lucide-react'

export interface Sticker {
  path: string
  category: string
  label?: string
}

/**
 * 表情选择器：从后端表情库选一张，插入 `<sticker:path>` 标记。
 * 与旧 StickerPicker 的核心行为一致（全部 / 最近 / 收藏），点击后由
 * ChatInput 插入标记，发送时后端按标记解析为贴纸。
 */
export function StickerPicker({ onSelect, onClose }: { onSelect: (sticker: Sticker) => void; onClose: () => void }) {
  const [all, setAll] = useState<Sticker[]>([])
  const [recent, setRecent] = useState<Sticker[]>([])
  const [favorites, setFavorites] = useState<Sticker[]>([])
  const [tab, setTab] = useState<'recent' | 'all' | 'fav'>('all')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      request<{ index: Record<string, Sticker> }>('/stickers/index'),
      request<{ recent: Sticker[] }>('/stickers/recent'),
      request<{ favorites: Sticker[] }>('/stickers/favorites'),
    ]).then(([a, r, f]) => {
      if (cancelled) return
      if (a.status === 'fulfilled') setAll(Object.values(a.value.index ?? {}))
      if (r.status === 'fulfilled') setRecent(r.value.recent ?? [])
      if (f.status === 'fulfilled') setFavorites(f.value.favorites ?? [])
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const categories = useMemo(() => Array.from(new Set(all.map((s) => s.category))).sort(), [all])
  const source = tab === 'recent' ? recent : tab === 'fav' ? favorites : all
  const shown = category ? source.filter((s) => s.category === category) : source

  const toggleFavorite = async (sticker: Sticker) => {
    const exists = favorites.some((f) => f.path === sticker.path)
    try {
      await request('/stickers/favorites', {
        method: exists ? 'DELETE' : 'POST',
        body: JSON.stringify({ path: sticker.path, category: sticker.category }),
      })
      setFavorites((prev) => exists ? prev.filter((f) => f.path !== sticker.path) : [...prev, sticker])
    } catch { /* 收藏失败不阻塞选图 */ }
  }

  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-[min(420px,80vw)] rounded-xl border border-border bg-popover p-2 shadow-lg" role="dialog" aria-label="表情选择器">
      <div className="mb-2 flex items-center gap-1">
        {([['all', '全部'], ['recent', '最近'], ['fav', '收藏']] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={tab === k ? 'secondary' : 'ghost'} onClick={() => { setTab(k); setCategory('') }}>{label}</Button>
        ))}
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="关闭表情选择器"><X /></Button>
      </div>

      {tab === 'all' && categories.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          <Button size="xs" variant={category === '' ? 'secondary' : 'ghost'} onClick={() => setCategory('')}>全部</Button>
          {categories.map((c) => (
            <Button key={c} size="xs" variant={category === c ? 'secondary' : 'ghost'} onClick={() => setCategory(c)}>{c}</Button>
          ))}
        </div>
      )}

      <div className="scrollbar-thin grid max-h-64 grid-cols-6 gap-1 overflow-y-auto">
        {loading && <p className="col-span-6 py-6 text-center text-xs text-muted-foreground">加载表情库…</p>}
        {!loading && shown.length === 0 && <p className="col-span-6 py-6 text-center text-xs text-muted-foreground">该分类下暂无表情</p>}
        {shown.map((s) => (
          <div key={s.path} className="group relative">
            <button
              type="button"
              onClick={() => onSelect(s)}
              className="flex size-12 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
              aria-label={s.label || s.path}
              title={s.label || s.path}
            >
              <img src={`/api/stickers/${s.category}/${s.path.split('/').pop()}`} alt={s.label || s.category} className="size-10 rounded object-contain" loading="lazy" />
            </button>
            <button
              type="button"
              onClick={() => void toggleFavorite(s)}
              className={cn('absolute right-0 top-0 rounded-full bg-popover/80 p-0.5 opacity-0 transition-opacity group-hover:opacity-100', favorites.some((f) => f.path === s.path) && 'text-status-warn opacity-100')}
              aria-label="收藏表情"
            >
              <Star className="size-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}