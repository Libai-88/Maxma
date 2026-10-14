/**
 * 主题色工具：供依赖 `--accent` 派生视觉变化的组件共用。
 *
 * 背景：动效背景组件原先读 `--accent-pink` 取得第二个色相，而该 token 只有
 * `midnight.css` 一个主题定义。其余主题走到 `|| '#e05af0'` 的硬编码兜底——
 * 于是「随主题变色」实际是「除子夜外一律紫色」。这里改为从当前 `--accent`
 * 在 HSL 环上取邻近色，任何主题都成立。
 */

/** `#rgb` / `#rrggbb` → [r, g, b]（0-255）。 */
export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** `#rgb` / `#rrggbb` → [h, s, l]（h: 0-360，s/l: 0-100）。 */
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return [h * 360, s * 100, l * 100]
}

/** [h, s, l] → `#rrggbb`。 */
export function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * 强调色的邻近色，用于背景动效的第二色相。
 *
 * 偏移 +28° 让两个色相在色轮上可辨又同族；轻微提亮/压暗避免呆板对称。
 */
export function deriveAltHue(accent: string, deg = 28): string {
  const [h, s, l] = hexToHsl(accent)
  const shifted = (h + deg) % 360
  return hslToHex(shifted, s, l > 50 ? Math.max(l - 6, 0) : Math.min(l + 8, 100))
}