/** 情绪关键词 → 表情包分类映射 */

const EMOTION_MAP: Record<string, string> = {
  '开心': '开心', '高兴': '开心', '哈哈': '开心', '嘻嘻': '开心', '真好': '开心',
  '委屈': '委屈', '难过': '委屈', '伤心': '委屈', '呜呜': '委屈', '哭': '委屈',
  '害羞': '害羞', '不好意思': '害羞', '羞': '害羞',
  '尴尬': '尴尬', '无语': '无语', '晕': '无语', '服了': '无语',
  '生气': '生气', '气死': '生气', '哼': '生气',
  '惊讶': '惊讶', '真的吗': '惊讶', '哇': '惊讶', '天哪': '惊讶',
  '撒娇': '撒娇', '好不好嘛': '撒娇', '人家': '撒娇',
  '悲伤': '悲伤', '泪': '悲伤',
  '得意': '得意', '厉害吧': '得意', '棒': '得意',
  '爱心': '爱心', '爱你': '爱心', '想你': '爱心', '喜欢': '爱心', '亲': '爱心',
  '日常': '日常',
}

const STICKER_DIRECTIVE_RE = /\[表情(?:包)?[:：][^\]]+\]/g

/** 从文本中检测情绪，返回贴纸分类名或 null */
export function detectEmotion(text: string): string | null {
  if (!text) return null
  const explicitMatch = text.match(/\[表情(?:包)?[:：]([^\]]+)\]/)
  if (explicitMatch && EMOTION_MAP[explicitMatch[1]]) return EMOTION_MAP[explicitMatch[1]]
  for (const [keyword, category] of Object.entries(EMOTION_MAP)) {
    if (text.includes(keyword)) return category
  }
  return null
}

/** Remove the agent-only sticker directive once its image has been resolved. */
export function stripStickerDirectives(text: string): string {
  return text.replace(STICKER_DIRECTIVE_RE, '').replace(/\n{2,}/g, '\n').trim()
}

/** 根据分类名获取随机贴纸 URL */
export function getStickerUrl(category: string): string {
  return `/api/stickers/random/${encodeURIComponent(category)}`
}
