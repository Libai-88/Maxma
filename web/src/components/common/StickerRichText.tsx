import { useEffect, useMemo, useState } from 'react'
import { Markdown } from '@/components/common/Markdown'
import { Sticker } from '@/components/common/Sticker'
import type { StickerMeme } from '@/types/sticker'
import { cn } from '@/lib/utils'
import { loadStickerIndex, resolveStickerMeme } from '@/utils/stickerUtils'

const TOKEN_RE = /(\[表情(?:包)?[:：]\s*[^\]\n]+\]|<sticker:[^<>\s]+>)/g

/**
 * 混合渲染正文与表情：显式 `[表情: 描述]` 解析成稳定图片，
 * 旧的 `<sticker:path>` 继续渲染；未命中的 token 原样保留，避免正文丢失。
 */
export function StickerRichText({
  content,
  markdown = true,
  className,
}: {
  content: string
  markdown?: boolean
  className?: string
}) {
  const [memes, setMemes] = useState<StickerMeme[]>([])
  const hasToken = TOKEN_RE.test(content)
  TOKEN_RE.lastIndex = 0

  useEffect(() => {
    if (!hasToken) return
    let cancelled = false
    void loadStickerIndex().then((next) => {
      if (!cancelled) setMemes(next)
    })
    return () => { cancelled = true }
  }, [hasToken, content])

  const parts = useMemo(() => {
    const out: Array<{ token: string | null; text: string }> = []
    let last = 0
    for (const match of content.matchAll(TOKEN_RE)) {
      const index = match.index ?? 0
      if (index > last) out.push({ token: null, text: content.slice(last, index) })
      out.push({ token: match[0], text: '' })
      last = index + match[0].length
    }
    if (last < content.length) out.push({ token: null, text: content.slice(last) })
    return out
  }, [content])

  return (
    <div className={cn('sticker-rich', className)}>
      {parts.map((part, i) => {
        if (!part.token) {
          return markdown
            ? <Markdown key={i} content={part.text} className="md-inline" />
            : <span key={i}>{part.text}</span>
        }
        const sticker = resolveStickerToken(part.token, memes)
        if (!sticker) return <span key={i}>{part.token}</span>
        return (
          <Sticker
            key={i}
            path={`${sticker.packId}/${sticker.path}`}
            alt={sticker.caption || '贴纸'}
            className="mx-0.5 my-1 align-middle"
          />
        )
      })}
    </div>
  )
}

function resolveStickerToken(token: string, memes: StickerMeme[]): StickerMeme | null {
  if (token.startsWith('<sticker:')) {
    const path = token.slice(8, -1)
    const hit = memes.find((m) => `${m.packId}/${m.path}` === path)
    if (hit) return hit
    // 旧格式 category/file：用旧路径匹配 pack 内的 path。
    return memes.find((m) => m.path === path) ?? null
  }
  const caption = token.replace(/^\[表情(?:包)?[:：]\s*/, '').replace(/\]$/, '')
  return resolveStickerMeme(caption, memes)
}
