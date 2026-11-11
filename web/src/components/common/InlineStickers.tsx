/**
 * 纯文本里的 `<sticker:category/file.webp>` 标记 → 内联贴纸图片。
 *
 * 用于不走 markdown 的场合（用户气泡、分享页）：
 *  - 用户在输入框插入贴纸时，文本里留下 `<sticker:path>`；
 *  - 分享页/历史回放的 user content 同样保留该标记。
 * markdown 正文由 `expandStickerTags()` 在渲染前统一处理，二者语义一致。
 */
const STICKER_TAG_RE = /<sticker:([^<>\s]+)>/g

export function InlineStickers({
  text,
  className,
  imgClassName = 'my-1 inline-block max-h-24 rounded-lg',
}: {
  text: string
  className?: string
  imgClassName?: string
}) {
  const parts: Array<{ sticker: string | null; text: string }> = []
  let last = 0
  for (const m of text.matchAll(STICKER_TAG_RE)) {
    const idx = m.index ?? 0
    if (idx > last) parts.push({ sticker: null, text: text.slice(last, idx) })
    parts.push({ sticker: m[1]!, text: '' })
    last = idx + m[0].length
  }
  if (last < text.length) parts.push({ sticker: null, text: text.slice(last) })

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.sticker
          ? <img key={i} src={`/api/stickers/${part.sticker}`} alt="贴纸" className={imgClassName} loading="lazy" />
          : <span key={i}>{part.text}</span>,
      )}
    </span>
  )
}

/** 该文本是否含贴纸标记（用于决定是否需要富渲染）。 */
export function hasStickerTag(text: string): boolean {
  return /<sticker:[^<>]+>/.test(text)
}