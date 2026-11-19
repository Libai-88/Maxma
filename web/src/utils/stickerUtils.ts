/**
 * 表情指令解析：把模型写的 `[表情: 描述]` / 旧的 `[表情包: 分类]`
 * 解析成 dsh-meme 的 `<sticker:packId/path>` 标记。
 *
 * 不做随机取图：模型看到的 caption 就是最终渲染的那张，前端不再二次换图。
 */
import { request } from '@/api'
import { getApiBase } from '@/utils/env'
import type { StickerMeme } from '@/types/sticker'

const EMOTION_MAP: Record<string, string> = {
  开心: 'happy', 高兴: 'happy', 哈哈: 'happy', 嘻嘻: 'happy', 真好: 'happy',
  委屈: 'sad', 难过: 'sad', 伤心: 'sad', 呜呜: 'sad', 哭: 'sad',
  害羞: 'shy', 不好意思: 'shy', 羞: 'shy',
  尴尬: 'confused', 无语: 'confused', 晕: 'confused', 服了: 'confused',
  生气: 'angry', 气死: 'angry', 哼: 'angry',
  惊讶: 'confused', 真的吗: 'confused', 哇: 'confused', 天哪: 'confused',
  撒娇: 'happy', 好不好嘛: 'happy', 人家: 'happy',
  悲伤: 'sad', 泪: 'sad',
  得意: 'happy', 厉害吧: 'happy', 棒: 'happy',
  爱心: 'happy', 爱你: 'happy', 想你: 'happy', 喜欢: 'happy', 亲: 'happy',
  日常: 'daily',
}

const STICKER_DIRECTIVE_RE = /\[表情(?:包)?[:：]\s*([^\]\n]+)\]/g
const MEME_DIRECTIVE_RE = /\[表情[:：]\s*([^\]\n]+)\]/g

let cached: { at: number; memes: StickerMeme[] } | null = null
let inflight: Promise<StickerMeme[]> | null = null

/** 拉取全量启用图库索引；10 秒内复用，避免流式阶段每条消息都打后端。 */
export async function loadStickerIndex(force = false): Promise<StickerMeme[]> {
  if (!force && cached && Date.now() - cached.at < 10_000) return cached.memes
  if (!force && inflight) return inflight
  inflight = request<{ memes?: StickerMeme[] }>('/stickers/index?packId=all')
    .then((data) => {
      const memes = Array.isArray(data.memes) ? data.memes : []
      cached = { at: Date.now(), memes }
      return memes
    })
    .catch(() => [])
    .finally(() => { inflight = null })
  return inflight
}

export function invalidateStickerIndexCache(): void {
  cached = null
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function resolveOne(token: string, memes: StickerMeme[]): StickerMeme | null {
  const value = normalize(token)
  if (!value) return null
  const exact = memes.find((m) => normalize(m.caption) === value)
  if (exact) return exact
  const byTag = memes.find((m) => m.tag === (EMOTION_MAP[value] ?? value))
  if (byTag) return byTag
  const byKeyword = memes.find((m) => normalize(m.keywords).split(/\s+/).includes(value))
  if (byKeyword) return byKeyword
  const byCaption = memes.find((m) => normalize(m.caption).includes(value))
  return byCaption ?? null
}

export function resolveStickerMeme(token: string, memes: StickerMeme[]): StickerMeme | null {
  return resolveOne(token, memes)
}

/** 把一段指令文本解析成贴纸标记；解析不到时保留原文，避免正文消失。 */
export async function replaceStickerDirectives(text: string): Promise<string> {
  if (!text || !STICKER_DIRECTIVE_RE.test(text)) return text
  STICKER_DIRECTIVE_RE.lastIndex = 0
  const memes = await loadStickerIndex()
  if (memes.length === 0) return text
  return text.replace(STICKER_DIRECTIVE_RE, (matched, token: string) => {
    const hit = resolveOne(token, memes)
    return hit ? `<sticker:${hit.packId}/${hit.path}>` : matched
  })
}

/** 同步版本，供已加载索引的渲染组件用。 */
export function resolveStickerDirectiveSync(text: string, memes: StickerMeme[]): string {
  if (!text || !STICKER_DIRECTIVE_RE.test(text)) return text
  STICKER_DIRECTIVE_RE.lastIndex = 0
  return text.replace(STICKER_DIRECTIVE_RE, (matched, token: string) => {
    const hit = resolveOne(token, memes)
    return hit ? `<sticker:${hit.packId}/${hit.path}>` : matched
  })
}

/** 判断文本中是否含表情指令（新协议或旧协议）。 */
export function hasStickerDirective(text: string): boolean {
  return /\[表情(?:包)?[:：][^\]]+\]/.test(text)
}

/** 旧接口保留：从文本检测情绪并返回旧分类名。 */
export function detectEmotion(text: string): string | null {
  if (!text) return null
  const explicit = text.match(MEME_DIRECTIVE_RE)
  if (explicit) {
    const token = explicit[1]?.trim() ?? ''
    const mapped = EMOTION_MAP[token]
    if (mapped) return mapped
    const byCaption = cached?.memes.find((m) => normalize(m.caption) === normalize(token))
    if (byCaption) return byCaption.tag
  }
  for (const [keyword, category] of Object.entries(EMOTION_MAP)) {
    if (text.includes(keyword)) return category
  }
  return null
}

export const EMOTION_TAG_RE = new RegExp(`\\[(${Object.keys(EMOTION_MAP).join('|')})\\]`, 'g')

/** 判断文本中是否含裸情感词标记（[爱心] 等）。 */
export function hasEmotionTag(text: string): boolean {
  EMOTION_TAG_RE.lastIndex = 0
  return EMOTION_TAG_RE.test(text)
}

/** 移除 agent-only 指令（旧调用点保留）。 */
export function stripStickerDirectives(text: string): string {
  const cleaned = text
    .replace(STICKER_DIRECTIVE_RE, '')
    .replace(EMOTION_TAG_RE, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return cleaned
}

/** 裸情感词标记 → 内联贴纸标签（旧调用点保留）。 */
export function replaceEmotionTags(text: string, emotion: string, stickerPath: string): string {
  const tag = `<sticker:${stickerPath}>`
  return text.includes(`[${emotion}]`)
    ? text.replace(new RegExp(`\\[${emotion}\\]`, 'g'), tag)
    : text
}

/** 旧随机接口保留给旧代码/测试；新 UI 不再调用。 */
export function getStickerUrl(category: string): string {
  return `${getApiBase()}/stickers/random/${encodeURIComponent(category)}`
}
