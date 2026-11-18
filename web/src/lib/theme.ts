/**
 * 主题（五套内置配色 × 浅色 / 深色）的唯一入口。
 *
 * 此前主题只有 light / dark 两态：选择即生效、写进 localStorage，
 * 但启动时没人读——重启后选了浅色的人照样看到深色，直到再点开外观页。
 * 引导页更糟：它往 `maxma-theme` 写，外观页读的是 `maxma.theme`，两个键互不相识。
 *
 * 现在把读、写、应用、启动恢复都收在这里；组件只调用 `setTheme`。
 * 旧版本存下的 `light` / `dark` 继续可用，分别迁移到暖纸的浅色 / 深色，
 * 不因为升级把用户已经选过的明暗丢掉（COMPAT-STORAGE-001）。
 */

export const THEME_FAMILY_IDS = ['flexoki', 'everforest', 'primrose', 'sakura', 'kanagawa'] as const

export type ThemeFamilyId = (typeof THEME_FAMILY_IDS)[number]
export type ThemeMode = 'light' | 'dark'
export type ThemeId = `${ThemeFamilyId}-${ThemeMode}`

export interface ThemeFamilyMeta {
  id: ThemeFamilyId
  name: string
  en: string
  desc: string
}

export const THEME_FAMILIES: readonly ThemeFamilyMeta[] = [
  {
    id: 'flexoki',
    name: '暖纸',
    en: 'Flexoki',
    desc: '暖纸、墨黑与铜青。像一本摊开的笔记，白天最耐看。',
  },
  {
    id: 'everforest',
    name: '苔原',
    en: 'Everforest',
    desc: '奶油纸与苔绿，低饱和、护眼，适合长时间阅读。',
  },
  {
    id: 'primrose',
    name: '蜜桃',
    en: 'Primrose Peach',
    desc: '蜜桃、报春粉与薄荷；深色是安静的苔藓夜。',
  },
  {
    id: 'sakura',
    name: '樱花',
    en: 'Light Pink',
    desc: '灰粉与炭黑，轻但不幼稚；深色留一点樱花的亮度。',
  },
  {
    id: 'kanagawa',
    name: '墨浪',
    en: 'Kanagawa',
    desc: '墨蓝、浪白与橘，安静，但强调色有锋利的边。',
  },
]

/** 沿用旧外观页的持久化键，保证升级后已保存的偏好不丢（COMPAT-STORAGE-001）。 */
export const THEME_STORAGE_KEY = 'maxma.theme'

export const DEFAULT_THEME: ThemeId = 'flexoki-dark'

export function themeId(family: ThemeFamilyId, mode: ThemeMode): ThemeId {
  return `${family}-${mode}`
}

export function getThemeMode(theme: ThemeId): ThemeMode {
  return theme.endsWith('-dark') ? 'dark' : 'light'
}

export function getThemeFamily(theme: ThemeId): ThemeFamilyId {
  return theme.slice(0, theme.lastIndexOf('-')) as ThemeFamilyId
}

export function isThemeId(value: unknown): value is ThemeId {
  if (typeof value !== 'string') return false
  return THEME_FAMILY_IDS.some((family) => value === `${family}-light` || value === `${family}-dark`)
}

export function readStoredTheme(): ThemeId {
  try {
    const value = globalThis.localStorage?.getItem(THEME_STORAGE_KEY)
    // 旧两态版本的值：迁移到暖纸家族，避免升级后选中态凭空消失。
    if (value === 'light') return 'flexoki-light'
    if (value === 'dark') return 'flexoki-dark'
    return isThemeId(value) ? value : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** 只作用于当前文档：切换 `dark` 类、`data-theme` 与 `color-scheme`。 */
export function applyTheme(theme: ThemeId): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const mode = getThemeMode(theme)
  root.classList.toggle('dark', mode === 'dark')
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = mode
}

export function persistTheme(theme: ThemeId): void {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* 忽略持久化失败（隐私模式 / 存储被禁用） */
  }
}

/** 用户主动切换：立即生效 + 落盘。 */
export function setTheme(theme: ThemeId): void {
  applyTheme(theme)
  persistTheme(theme)
}

/** 启动时恢复：把上次保存的偏好应用到文档，避免首屏闪一次深色。 */
export function restoreTheme(): ThemeId {
  const theme = readStoredTheme()
  applyTheme(theme)
  return theme
}
