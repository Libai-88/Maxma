import { computed, type Ref } from 'vue'
import { getApiBase } from '@/utils/env'
import { EMOTION_TAG_RE } from '@/composables/stickerUtils'

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

/**
 * 解析内容中的 <sticker:category/filename.webp>、[表情包:category] 或裸情感词标记
 * （[开心]/[爱心] 等，见 EMOTION_TAG_RE），返回文字与表情交替的分段数组。
 */
export function useStickerSegments(textSource: Ref<string>) {
  return computed<Segment[]>(() => {
    const text = textSource.value
    if (!text) return []

    const segs: Segment[] = []
    let cursor = 0

    // 三类标记：完整路径 <sticker:path>、指令 [表情:cat] / [表情包:cat]、裸情感词 [爱心]
    // 分别用正则字面量匹配（避免字符串拼接的转义问题），每次取最近的匹配。
    const PATH_RE = /<sticker:([^>]+)>/g
    const DIRECTIVE_RE = /\[表情(?:包)?[:：]([^\]]+)\]/g

    while (cursor < text.length) {
      // 从 cursor 起找三个正则各自的最近匹配
      PATH_RE.lastIndex = cursor
      DIRECTIVE_RE.lastIndex = cursor
      EMOTION_TAG_RE.lastIndex = cursor
      const p = PATH_RE.exec(text)
      const d = DIRECTIVE_RE.exec(text)
      const e = EMOTION_TAG_RE.exec(text)

      // 选出 index 最小的；指令/路径优先于情感词（长标记先匹配，避免情感词吞掉指令内部）
      const candidates = [
        p ? { idx: p.index, len: p[0].length, seg: makePathSegment(p[1], p.index, p[0].length) } : null,
        d ? { idx: d.index, len: d[0].length, seg: makeDirectiveSegment(d[1], d.index, d[0].length) } : null,
        e ? { idx: e.index, len: e[0].length, seg: makeEmotionSegment(e[1], e.index, e[0].length) } : null,
      ].filter(Boolean) as { idx: number; len: number; seg: Segment }[]

      if (!candidates.length) break

      candidates.sort((a, b) => a.idx - b.idx || b.len - a.len)
      const next = candidates[0]

      if (next.idx > cursor) {
        segs.push({ type: 'text', text: text.slice(cursor, next.idx) })
      }
      segs.push(next.seg)
      cursor = next.idx + next.len
    }

    if (cursor < text.length) {
      segs.push({ type: 'text', text: text.slice(cursor) })
    }

    return segs
  })
}

function makePathSegment(path: string, start: number, length: number): StickerSegment {
  const slashIndex = path.indexOf('/')
  const category = slashIndex === -1 ? path : path.slice(0, slashIndex)
  const filename = slashIndex === -1 ? '' : path.slice(slashIndex + 1)
  return {
    type: 'sticker',
    src: `${getApiBase()}/stickers/${path}`,
    path,
    category,
    filename,
    occurrenceKey: `${path}@${start}`,
    start,
    end: start + length,
  }
}

function makeDirectiveSegment(category: string, start: number, length: number): StickerSegment {
  return {
    type: 'sticker',
    src: '',
    path: '',
    category,
    filename: '',
    occurrenceKey: `directive-${category}@${start}`,
    start,
    end: start + length,
  }
}

function makeEmotionSegment(emotion: string, start: number, length: number): StickerSegment {
  return {
    type: 'sticker',
    src: '',
    path: '',
    category: emotion,
    filename: '',
    occurrenceKey: `emotion-${emotion}@${start}`,
    start,
    end: start + length,
  }
}
