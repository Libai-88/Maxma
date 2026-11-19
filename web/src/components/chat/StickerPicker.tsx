import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Search, Send, Settings2, X } from 'lucide-react'
import { getStickerIndex, getStickerPacks, getStickerSettings } from '@/api/stickers'
import type { StickerMeme, StickerPack, StickerSettings } from '@/types/sticker'

export interface Sticker {
  /** 稳定标记 `<sticker:packId/path>` 或 `[表情: caption]` 的源数据。 */
  path: string
  category: string
  label?: string
  packId?: string
  packName?: string
  url?: string
  caption?: string
  keywords?: string
  marker?: string
}

export interface StickerPickerProps {
  onSelect: (sticker: Sticker) => void
  /** 点击即发送（pickerSendOnClick）；不提供时退化为插入输入框。 */
  onSendNow?: (sticker: Sticker) => void
  onManage?: () => void
  onClose: () => void
}

function toPickerSticker(meme: StickerMeme): Sticker {
  return {
    path: `${meme.packId}/${meme.path}`,
    category: meme.tag,
    label: meme.caption || meme.file_name,
    packId: meme.packId,
    packName: meme.packName,
    url: meme.url,
    caption: meme.caption,
    keywords: meme.keywords,
    marker: `[表情: ${meme.caption || meme.file_name}]`,
  }
}

/**
 * 表情选择器（dsh-meme 信息结构）：图库筛选、情绪/关键词搜图、
 * 点击插入 `[表情: 描述]` 或直接发送；悬浮预览不遮挡选择区。
 */
export function StickerPicker({ onSelect, onSendNow, onManage, onClose }: StickerPickerProps) {
  const [memes, setMemes] = useState<StickerMeme[]>([])
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([])
  const [packs, setPacks] = useState<StickerPack[]>([])
  const [settings, setSettings] = useState<StickerSettings | null>(null)
  const [packId, setPackId] = useState('all')
  const [tag, setTag] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Sticker | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // 打开即把焦点交给搜索框，Esc/Tab 才有稳定的起点；关闭后的焦点由调用方恢复。
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const focusables = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([getStickerIndex('all'), getStickerPacks(), getStickerSettings()])
      .then(([indexRes, packsRes, settingsRes]) => {
        if (cancelled) return
        if (indexRes.status === 'fulfilled') {
          setMemes(indexRes.value.memes ?? [])
          setTags(indexRes.value.tags ?? [])
        } else {
          setError('表情库加载失败；请确认后端已启动并生成索引')
        }
        if (packsRes.status === 'fulfilled') setPacks(packsRes.value.packs ?? [])
        if (settingsRes.status === 'fulfilled') {
          setSettings(settingsRes.value.settings)
          setPackId(settingsRes.value.settings.packId || 'all')
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return memes.filter((m) => {
      if (packId !== 'all' && m.packId !== packId) return false
      if (tag && m.tag !== tag) return false
      if (q && !`${m.caption} ${m.keywords} ${m.file_name} ${m.tag}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [memes, packId, tag, query])

  const choose = (m: StickerMeme) => {
    const sticker = toPickerSticker(m)
    if (settings?.pickerSendOnClick && onSendNow) onSendNow(sticker)
    else onSelect(sticker)
  }

  return (
    <div ref={rootRef} onKeyDown={onDialogKeyDown} className="absolute bottom-full left-0 z-30 mb-2 w-[min(520px,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-3 shadow-popover" role="dialog" aria-label="表情选择器">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜描述 / 关键词 / 文件名"
            aria-label="搜索表情"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="清除搜索" className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {onManage && (
          <Button variant="ghost" size="icon-sm" onClick={onManage} aria-label="管理图库" title="管理图库">
            <Settings2 />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭表情选择器"><X /></Button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        <Button size="xs" variant={packId === 'all' ? 'secondary' : 'ghost'} onClick={() => setPackId('all')}>全部图库</Button>
        {(packs.length ? packs : []).filter((p) => p.enabled || p.id === settings?.packId).map((p) => (
          <Button key={p.id} size="xs" variant={packId === p.id ? 'secondary' : 'ghost'} onClick={() => setPackId(p.id)} title={p.description}>
            {p.name}<span className="ml-1 text-muted-foreground">{p.count}</span>
          </Button>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          <Button size="xs" variant={tag === '' ? 'secondary' : 'ghost'} onClick={() => setTag('')}>全部</Button>
          {tags.map((t) => (
            <Button key={t.tag} size="xs" variant={tag === t.tag ? 'secondary' : 'ghost'} onClick={() => setTag(t.tag)}>
              {t.tag}<span className="ml-1 text-muted-foreground">{t.count}</span>
            </Button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-xs text-muted-foreground">加载表情库…</p>
      ) : error ? (
        <p className="py-10 text-center text-xs text-destructive">{error}</p>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">没有匹配的表情</p>
      ) : (
        <div className="scrollbar-thin grid max-h-[min(22rem,50vh)] grid-cols-6 gap-1 overflow-y-auto">
          {shown.map((m) => {
            const s = toPickerSticker(m)
            return (
              <div key={`${m.packId}:${m.path}`} className="group relative">
                <button
                  type="button"
                  onClick={() => choose(m)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      choose(m)
                    }
                  }}
                  onMouseEnter={() => setPreview(s)}
                  onFocus={() => setPreview(s)}
                  onMouseLeave={() => setPreview(null)}
                  onBlur={() => setPreview(null)}
                  className={cn(
                    'flex aspect-square w-full items-center justify-center rounded-md transition-colors duration-fast ease-standard hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60',
                    settings?.pickerSendOnClick && 'hover:ring-2 hover:ring-ring/40',
                  )}
                  aria-label={s.label}
                  title={settings?.pickerSendOnClick ? `点击直接发送：${s.label}` : `插入：${s.label}`}
                >
                  <img src={s.url} alt={s.label} className="size-10 rounded object-contain" loading="lazy" decoding="async" />
                </button>
                {settings?.pickerSendOnClick && (
                  <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-primary/90 p-0.5 text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    <Send className="size-2.5" />
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {preview && (
        <div className="pointer-events-none absolute bottom-full right-2 z-40 mb-2 w-40 rounded-xl border border-border bg-popover p-2 shadow-popover">
          <img src={preview.url} alt={preview.label} className="mx-auto max-h-32 w-auto rounded-md object-contain" />
          <p className="mt-1 line-clamp-2 text-center text-micro text-muted-foreground">{preview.label}</p>
        </div>
      )}
    </div>
  )
}
