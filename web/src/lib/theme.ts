/**
 * 主题（Solid Glass 的 light / dark 两态）的唯一入口。
 *
 * 此前主题只存在「访客打开外观页」这条路径里：选择即生效、写进 localStorage，
 * 但**启动时没人读**——重启后选了浅色的人照样看到深色，直到再点开外观页。
 * 引导页更糟：它往 `maxma-theme` 写，外观页读的是 `maxma.theme`，两个键互不相识。
 *
 * 所以把读、写、应用、启动恢复都收在这里；组件只调用 `setTheme` / 读 `useTheme`。
 */

export type ThemeId = 'light' | 'dark'

/** 沿用旧外观页的持久化键，保证升级后已保存的偏好不丢（COMPAT-STORAGE-001）。 */
export const THEME_STORAGE_KEY = 'maxma.theme'

export const DEFAULT_THEME: ThemeId = 'dark'

export function isThemeId(value: unknown): value is ThemeId {
  return value === 'light' || value === 'dark'
}

export function readStoredTheme(): ThemeId {
  try {
    const value = globalThis.localStorage?.getItem(THEME_STORAGE_KEY)
    return isThemeId(value) ? value : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** 只作用于当前文档：切换 `dark` 类、`data-theme` 与 `color-scheme`。 */
export function applyTheme(theme: ThemeId): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
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
