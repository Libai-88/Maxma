/**
 * 主题 token 契约测试。
 *
 * ## 背景（真实缺陷，非风格洁癖）
 *
 * `MessageBubble.vue` 用 `--user-bubble-solid` 给用户气泡上色，而它在 `tokens.css`
 * 里回落到 `var(--accent-pink, #D4A5A5)`——那是**上一代品牌**（远山青/粉红）的值。
 * `--accent-pink` 当时只有 `midnight.css` 一个主题定义，于是：
 *
 *   - 5 个主题（含旗舰 `suying`）的用户气泡 = `#D4A5A5` 旧品牌粉；
 *   - `suying.css` 还把 `--user-bubble` / `--user-bubble-bg` 写死成 `#F8F5EF`，
 *     恰好等于 `--bg-card`——也就是 AI 气泡的颜色，**对比度 1.00，肉眼分不出谁说的**。
 *
 * 对一个「对话即界面」为核心原则的产品，这是可用性缺陷，不只是配色不好看。
 * 旧评审（`UI_UX_REVIEW.md`，已过期）提过同一问题，换了新配色后换个形式继续存在。
 *
 * ## 本测试锁住什么
 *
 *   1. **用户气泡与 AI 气泡可辨**——不靠「够不够好看」，靠实测对比度阈值；
 *   2. **气泡文字可读**——修好气泡不能换来「看得见气泡看不清字」；
 *   3. **必填 token 齐全**——新增主题漏填必填项会红；
 *   4. **无野生回退值**——消费一个「并非所有主题都定义」的 token 时必须自带兜底，
 *      这条正是能自动抓住本次 P0 的规则。
 *
 * ## 为什么自己解析 CSS
 *
 * jsdom 不加载外部样式表也不解析 `@theme` 作用域，这里需要的是**静态契约**：
 * 读主题文件、建 token 表、算对比度。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { deriveAltHue } from '@/utils/themeColor'

const THEMES_DIR = join(__dirname, '../src/themes')
const TOKENS_CSS = join(__dirname, '../src/assets/styles/tokens.css')

/** 主题「必填」契约：缺任一项即视为不合格主题。 */
const REQUIRED_TOKENS = [
  // 表面 4
  '--bg-primary', '--bg-secondary', '--bg-card', '--bg-raised',
  // 文字 4
  '--text-primary', '--text-secondary', '--text-tertiary', '--text-inverse',
  // 强调 4
  '--accent', '--accent-hover', '--accent-active', '--accent-light',
  // 边框 3
  '--border', '--border-strong', '--border-accent',
  // 状态 4
  '--status-ok', '--status-error', '--status-warn', '--status-info',
  // 圆角 4
  '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl',
  // 阴影 4
  '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-xl',
  // 动效 2
  '--duration-fast', '--ease-out',
  // 布局 2
  '--sidebar-width', '--chat-max-width',
  // 专用 2：工具底 + 对话可辨性所依赖的这一对
  '--tool-bg', '--user-bubble-solid', '--user-bubble-text',
] as const

/** 主题可以额外定义（扩展 token），但消费它的代码必须自带兜底。 */
const OPTIONAL_TOKENS = new Set(['--accent-pink', '--accent-pink-light', '--accent-pink-soft'])

/** src/ 下读取 token 的代码位置（CSS 之外的消费点）。 */
const THEME_TOKEN_CONSUMERS = ['components/LiquidBackground.vue', 'components/ThinkingWave.vue']

/** 去掉注释后再取 token，避免把「注释里提过」误判成「定义了」。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** 递归列出目录下的文件（相对路径）。 */
function walk(dir: string): string[] {
  return readdirSync(join(__dirname, '..', dir)).flatMap((entry) => {
    const rel = `${dir}/${entry}`
    return statSync(join(__dirname, '..', rel)).isDirectory() ? walk(rel) : [rel]
  })
}

/** 取 `--name: value` 声明（`color-mix(...)` 等嵌套括号会正确吃到闭合处）。 */
function parseTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const m of stripComments(css).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const name = m[1]
    if (!tokens.has(name)) tokens.set(name, m[2].trim())
  }
  return tokens
}

/** 解析 `#rgb` / `#rrggbb`；非字面色（如 color-mix / 具名色）返回 null。 */
function hex(token: string | undefined): string | null {
  if (!token) return null
  const m = token.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return `#${h.toLowerCase()}`
}

/** WCAG 相对亮度。 */
function luminance(color: string): number {
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const r = channel(parseInt(color.slice(1, 3), 16) / 255)
  const g = channel(parseInt(color.slice(3, 5), 16) / 255)
  const b = channel(parseInt(color.slice(5, 7), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 对比度；输入需为 hex。 */
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** 复现 CSS `color-mix(in srgb, a p%, b)`，用于校验派生 token 的实际对比度。 */
function mixRgb(a: string, pctA: number, b: string): string {
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2]
    .map((i) => Math.round(ch(a, i) * pctA + ch(b, i) * (1 - pctA)).toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 复现「半透明色叠在底色之上」的实际观感（alpha 合成）。
 *
 * 这是本文件里最容易被忽略的一类 bug：`color-mix(..., 8%, transparent)`
 * 看上去只是「很淡的一层色」，但它叠在什么底色上，决定了文字能不能看清。
 */
function over(fg: string, bg: string, alpha: number): string {
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2]
    .map((i) => Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')
}

interface Theme {
  name: string
  tokens: Map<string, string>
  /** 该主题声明（或从 tokens.css 继承）的最终值。 */
  resolve: (token: string) => string | undefined
}

function loadTheme(file: string): Theme {
  const name = file.replace(/\.css$/, '')
  const tokens = parseTokens(readFileSync(join(THEMES_DIR, file), 'utf8'))
  const base = parseTokens(readFileSync(TOKENS_CSS, 'utf8'))
  return {
    name,
    tokens,
    // 主题文件定义优先；否则回落到 tokens.css 的全局默认——与浏览器级联一致。
    resolve: (token) => tokens.get(token) ?? base.get(token),
  }
}

const themes = readdirSync(THEMES_DIR)
  .filter((f) => f.endsWith('.css'))
  .map(loadTheme)

describe('主题 token 契约', () => {
  test('每个主题都定义了全部必填 token', () => {
    const missing = themes.flatMap((t) =>
      REQUIRED_TOKENS.filter((token) => !t.tokens.has(token)).map((token) => `${t.name} 缺 ${token}`),
    )
    expect(missing).toEqual([])
  })

  test('用户气泡与 AI 气泡可辨（对比度 ≥ 1.2）', () => {
    const failures = themes
      .map((t) => {
        const user = hex(t.resolve('--user-bubble-solid'))
        const assistant = hex(t.resolve('--bg-card'))
        // 非字面色无法静态判定，交给渲染层保证（当前 6 个主题均为字面色）。
        if (!user || !assistant) return null
        return contrast(user, assistant) >= 1.2 ? null : `${t.name}: ${user} vs ${assistant} = ${contrast(user, assistant).toFixed(2)}`
      })
      .filter(Boolean)

    expect(failures).toEqual([])
  })

  test('用户气泡文字在其底色上可读（对比度 ≥ 4.5）', () => {
    const failures = themes
      .map((t) => {
        const bg = hex(t.resolve('--user-bubble-solid'))
        const fg = hex(t.resolve('--user-bubble-text'))
        if (!bg || !fg) return `${t.name}: 用户气泡非字面色，无法静态判定`
        return contrast(fg, bg) >= 4.5 ? null : `${t.name}: ${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)}`
      })
      .filter(Boolean)

    expect(failures).toEqual([])
  })

  test('状态色·文字版在卡片底上可读（对比度 ≥ 4.5）', () => {
    // 藤黄 #C99A5A 在宣纸底只有 2.34:1，作背景可以，作文字偏淡。
    // 变体是「向 --text-primary 靠拢 30%」——明色主题自动变深、暗色主题自动变亮
    // （它们的 --text-primary 本就是浅色），所以一个公式覆盖 6 个主题。
    // MIX 与 tokens.css 里的 color-mix 比例必须一致，改一处要改两处。
    const MIX = 0.3
    const STATUSES = ['ok', 'warn', 'error', 'info'] as const
    const failures: string[] = []

    for (const theme of themes) {
      const card = hex(theme.resolve('--bg-card'))
      const ink = hex(theme.resolve('--text-primary'))
      expect(card, `${theme.name} 的 --bg-card 应为字面色`).not.toBeNull()
      expect(ink, `${theme.name} 的 --text-primary 应为字面色`).not.toBeNull()

      for (const status of STATUSES) {
        const base = hex(theme.resolve(`--status-${status}`))
        expect(base, `${theme.name} 的 --status-${status} 应为字面色`).not.toBeNull()
        const mixed = mixRgb(base!, MIX, ink!)
        const cr = contrast(mixed, card!)
        if (cr < 4.5) failures.push(`${theme.name} --status-${status}-text = ${mixed} → ${cr.toFixed(2)}`)
      }
    }

    expect(failures).toEqual([])
  })

  test('弹窗内文字在「玻璃层 + 其后页面」之上可读', () => {
    // 真实报障：深色主题下设置弹窗文字几乎看不见。
    //
    // 成因是两个约定叠加：
    //   1. `AnimatedModalBody` 的玻璃底曾用 `color-mix(--text-inverse 8%, transparent)`，
    //      叠在页面之上——明色主题下这层接近白，深色主题下接近深，**方向由主题决定**；
    //   2. `SettingsModalContent` 把标题、卡片标题等正文一律写成 `var(--text-inverse)`，
    //      而 `--text-inverse` 的语义是「**给实底色块用的亮/暗字**」，
    //      不是「压在页面上的文字色」。
    // 两者一叠加：`--text-inverse` 恰好与玻璃层同源，等于同色压同色 → 对比度 1.00。
    //   注意这在**明色主题同样是 1.06~1.13**——只是白底白字比黑底黑字更难被察觉。
    //
    // 修法确立的约定：弹窗是「浮在页面上的一层卡片」，因此
    //   - 玻璃底从 `--bg-card` / `--bg-raised` 派生，不用 `--text-inverse`；
    //   - 压在弹窗上的正文用 `--text-primary` / `--text-secondary`；
    //   - `--text-inverse` 只用于「实底色块之上」（如 accent 按钮上的白字）。
    const failures: string[] = []

    for (const theme of themes) {
      const primary = hex(theme.resolve('--text-primary'))!
      const secondary = hex(theme.resolve('--text-secondary'))!
      // AnimatedModalBody 玻璃底：bg-raised 92% + accent 8%
      const glass = mixRgb(hex(theme.resolve('--bg-raised'))!, 0.92, hex(theme.resolve('--accent'))!)
      // SettingsModalContent 卡片面：--text-primary 3% 叠在玻璃层上
      const surface = mixRgb(primary, 0.03, glass)

      for (const [role, fg] of [['标题', primary], ['次要文字', secondary]] as const) {
        const cr = contrast(fg, surface)
        if (cr < 4.5) failures.push(`${theme.name} ${role} ${fg} 压在卡片面 ${surface} 上仅 ${cr.toFixed(2)}`)
      }
    }

    expect(failures).toEqual([])
  })

test('--text-inverse 只用在「实底色块」上，不用于透明面', () => {
    // `--text-inverse` 的语义是「给实底色块用的亮/暗字」（accent 按钮上的白字）。
    // 把它当「压在页面/玻璃上的正文色」用，就会与半透明面同色压同色 → 对比度 1.00。
    // 本次报障（深色主题设置弹窗文字不可见）正是这么来的。
    //
    // 白名单：这些组件整体是**深色媒体浮层**（底为 72%~92% 的 --text-primary），
    // 浮层上用 --text-inverse 是对的，不属于本条禁令。
    const DARK_OVERLAYS = ['StickerPreviewOverlay.vue', 'StickerInline.vue', 'MediaViewer.vue']
    // 其余允许把 --text-inverse 用在实底上的样式关键字
    const SOLID_BG = /background\s*:[^;]*var\(--(accent|status-\w+|danger|user-bubble-solid)\b/
    const offenders: string[] = []

    for (const file of walk('src')) {
      if (!/\.(vue|css)$/.test(file)) continue
      if (DARK_OVERLAYS.some((d) => file.endsWith(d))) continue
      const src = readFileSync(join(__dirname, '..', file), 'utf8')
      const lines = src.split('\n')
      lines.forEach((line, i) => {
        if (!/color\s*:\s*var\(--text-inverse\)/.test(line)) return
        // background 可能写在 color 之前或之后（压缩 CSS 与手写样式顺序不一），
        // 所以取前后各 5 行作为「同一条规则」的近似。
        const ctx = lines.slice(Math.max(0, i - 5), i + 6).join(' ')
        if (!SOLID_BG.test(ctx)) offenders.push(`${file}:${i + 1}`)
      })
    }

    expect(offenders.length ? `这些地方的 --text-inverse 不在实底上：${offenders.join(', ')}` : '').toBe('')
  })

test('代码只消费 --user-bubble-solid / --user-bubble-text 这一对', () => {
    // 回归「四写法并存」：主聊天、轻量聊天、iframe 沙箱曾各用不同的名字/组合，
    // 导致轻量页与主应用对「用户气泡」的理解分叉。
    const legacy = ['--user-bubble)', '--user-bubble-bg', 'var(--user-bubble,']
    const offenders: string[] = []

    for (const file of walk('src')) {
      if (!/\.(vue|css|ts)$/.test(file)) continue
      const code = stripComments(readFileSync(join(__dirname, '..', file), 'utf8'))
      if (legacy.some((p) => code.includes(p))) offenders.push(file)
    }

    expect(offenders.length ? `仍消费旧 token：${offenders.join(', ')}` : '').toBe('')
  })

  test('动效组件不再消费「并非所有主题都定义」的 token', () => {
    // 回归本次 P0 的成因：--accent-pink 只有 1/6 主题定义，却被两个动效组件读取，
    // 其余主题静默落到硬编码兜底色（「随主题变色」实际是「除子夜外一律紫」）。
    // 只看代码不看注释——注释里可以保留这段事故说明。
    const stale = THEME_TOKEN_CONSUMERS.filter((file) =>
      stripComments(readFileSync(join(__dirname, '../src', file), 'utf8')).includes('--accent-pink'),
    )

    expect(stale.length ? `仍在读仅部分主题定义的 token：${stale.join(', ')}` : '').toBe('')
  })

  test('deriveAltHue 从任意主题色派生出同族第二色相', () => {
    // 替代方案必须对任何主题成立——这是「不再是野生值」的关键。
    for (const theme of themes) {
      const accent = hex(theme.resolve('--accent'))
      expect(accent, `${theme.name} 的 --accent 应为字面色`).not.toBeNull()
      const alt = deriveAltHue(accent!)
      // 合法 hex，且须与原色可辨（对比度 1 即同色，动效会只剩一层）。
      expect(alt).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrast(alt, accent!), `${theme.name}: 派生色不应等于原色`).toBeGreaterThan(1)
    }
  })
})