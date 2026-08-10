/**
 * 码点安全的字符串截断（TRUNCATE-001）。
 * String.prototype.slice 按 UTF-16 码元截断，会切断代理对（emoji 等）
 * 导致显示替换符。此函数按 Unicode 码点计数截断。
 */

/** 码点安全截断：取前 max 个码点 */
export function truncateByCodePoints(text: string, max: number): string {
  if (!text || max <= 0) return ''
  let out = ''
  let count = 0
  for (const ch of text) {
    if (count >= max) break
    out += ch
    count++
  }
  return out
}

/** 带省略号的码点安全截断 */
export function truncateWithEllipsis(text: string, max: number): string {
  if (!text) return ''
  if (max <= 0) return ''
  const truncated = truncateByCodePoints(text, max)
  return truncated.length < text.length ? truncated + '…' : text
}
