import { computed, type Ref } from 'vue'
import { getApiBase } from '@/utils/env'

export interface TextSegment {
  type: 'text'
  text: string
}

export interface StickerSegment {
  type: 'sticker'
  src: string
  path: string
  category: string
  filename: string
  occurrenceKey: string
  start: number
  end: number
}

export type Segment = TextSegment | StickerSegment

const STICKER_REGEX = /<sticker:([^>]+)>|\[表情(?:包)?:([^\]]+)\]/g

/**
 * 解析内容中的 <sticker:category/filename.webp> 或 [表情包:category] 标记，
 * 返回文字与表情交替的分段数组。
 */
export function useStickerSegments(textSource: Ref<string>) {
  return computed<Segment[]>(() => {
    const text = textSource.value
    if (!text) return []

    const segs: Segment[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    // 重置正则状态（全局正则复用时需要）
    STICKER_REGEX.lastIndex = 0

    while ((match = STICKER_REGEX.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segs.push({ type: 'text', text: text.slice(lastIndex, match.index) })
      }
      const path = match[1]
      const directiveCategory = match[2]
      const start = match.index
      const end = match.index + match[0].length

      if (path) {
        const slashIndex = path.indexOf('/')
        const category = slashIndex === -1 ? path : path.slice(0, slashIndex)
        const filename = slashIndex === -1 ? '' : path.slice(slashIndex + 1)
        segs.push({
          type: 'sticker',
          src: `${getApiBase()}/stickers/${path}`,
          path,
          category,
          filename,
          occurrenceKey: `${path}@${start}`,
          start,
          end,
        })
      } else if (directiveCategory) {
        // [表情包:category] / [表情:category] 占位符：src 留空，由 StickerInline 异步解析
        segs.push({
          type: 'sticker',
          src: '',
          path: '',
          category: directiveCategory,
          filename: '',
          occurrenceKey: `directive-${directiveCategory}@${start}`,
          start,
          end,
        })
      }
      lastIndex = end
    }

    if (lastIndex < text.length) {
      segs.push({ type: 'text', text: text.slice(lastIndex) })
    }

    return segs
  })
}
