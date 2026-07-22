// web/src/composables/useTheme.ts
// 主题切换 composable — v2.0 6 主题（2 旗舰 + 2 变体 + 2 保留 + auto）
// 替代 v1.17 旧主题系统

import { ref, computed, watch } from 'vue'

/** 主题 ID 类型 */
export type ThemeId =
  | 'auto'
  | 'suying'
  | 'ultraline'
  | 'night'
  | 'kintsugi'
  | 'grass'
  | 'midnight'

/** 主题分组 */
export type ThemeGroup = 'flagship' | 'variant' | 'legacy'

/** 主题元信息 */
export interface ThemeMeta {
  id: ThemeId
  name: string
  description: string
  group: ThemeGroup
  isDark: boolean
  preview: { bg: string; accent: string; text: string }
}

/** v2.0 全部主题元信息 */
export const THEMES: ThemeMeta[] = [
  {
    id: 'auto',
    name: '自动',
    description: '跟随系统明暗',
    group: 'flagship',
    isDark: false,
    preview: { bg: 'linear-gradient(135deg, #F7F4EE 50%, #0D1117 50%)', accent: '#C23B22', text: '#1C1C1C' },
  },
  // ══ 旗舰 ══
  {
    id: 'suying',
    name: '素影',
    description: '宣纸白 + 朱砂印，墨分五色的数字文房',
    group: 'flagship',
    isDark: false,
    preview: { bg: '#F7F4EE', accent: '#C23B22', text: '#1C1C1C' },
  },
  {
    id: 'ultraline',
    name: '極線',
    description: '纯白黑蓝 + 1px 法则，不可能更少',
    group: 'flagship',
    isDark: false,
    preview: { bg: '#FFFFFF', accent: '#0066FF', text: '#0D0D0D' },
  },
  // ══ 变体 ══
  {
    id: 'night',
    name: '夜航',
    description: '深空蓝黑 + 导航星金，深夜里的导航员',
    group: 'variant',
    isDark: true,
    preview: { bg: '#0D1117', accent: '#D4A853', text: '#E6EDF3' },
  },
  {
    id: 'kintsugi',
    name: '金継',
    description: '陶胎灰白 + 金継線，破碎中的完美',
    group: 'variant',
    isDark: false,
    preview: { bg: '#F5F0E8', accent: '#C8A84E', text: '#2C2416' },
  },
  // ══ 保留 ══
  {
    id: 'grass',
    name: '青草香',
    description: '冷绿淡彩，清晨工作台',
    group: 'legacy',
    isDark: false,
    preview: { bg: '#F5F8F3', accent: '#5B8C5F', text: '#2D3F30' },
  },
  {
    id: 'midnight',
    name: '青夜',
    description: '深青蓝底 + 暖玫瑰，不说故事的暗色',
    group: 'legacy',
    isDark: true,
    preview: { bg: '#3B4A54', accent: '#C99AAF', text: '#E1EAF0' },
  },
]

const STORAGE_KEY = 'maxma.theme'
const DEFAULT_THEME: ThemeId = 'suying'
const AUTO_LIGHT: ThemeId = 'suying'
const AUTO_DARK: ThemeId = 'night'

/** 当前存储的主题设置（auto 或具体主题） */
const storedTheme = ref<ThemeId>(loadStoredTheme())

/** 系统是否暗色 */
const systemMql = window.matchMedia('(prefers-color-scheme: dark)')
const systemIsDark = ref(systemMql.matches)

// 监听系统主题变化（使用 systemMql 自身属性标记，避免 HMR 重复注册）
function onSystemThemeChange(e: MediaQueryListEvent) {
  systemIsDark.value = e.matches
}
// 在 MediaQueryList 对象上挂载标记，此对象在 HMR 中存活，可防重复注册
	if (!(systemMql as unknown as Record<string, unknown>)._themeListenerAttached) {
	  systemMql.addEventListener('change', onSystemThemeChange)
	  ;(systemMql as unknown as Record<string, unknown>)._themeListenerAttached = true
	}

/** 移除系统主题变化监听器（用于清理 / HMR / 测试） */
export function cleanupThemeListener() {
  systemMql.removeEventListener('change', onSystemThemeChange)
	;(systemMql as unknown as Record<string, unknown>)._themeListenerAttached = false
}

/** 当前实际生效的主题（auto 解析后） */
const activeTheme = computed<ThemeId>(() => {
  if (storedTheme.value === 'auto') {
    return systemIsDark.value ? AUTO_DARK : AUTO_LIGHT
  }
  return storedTheme.value
})

/** 当前是否暗色（供 StickerInline 等使用） */
const isDark = computed(() => {
  const t = activeTheme.value
  const found = THEMES.find(m => m.id === t)
  if (!found) {
    console.warn(`[useTheme] 主题 ID "${t}" 未在 THEMES 表中找到，回退到 isDark=false`)
  }
  return found?.isDark ?? false
})

function loadStoredTheme(): ThemeId {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return DEFAULT_THEME
  const valid = THEMES.find(t => t.id === raw)
  return valid ? (raw as ThemeId) : DEFAULT_THEME
}

function setTheme(theme: ThemeId) {
  storedTheme.value = theme
  localStorage.setItem(STORAGE_KEY, theme)
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute('data-theme', theme)
}

// 自动应用主题到 DOM
watch(activeTheme, (t) => applyTheme(t), { immediate: true })

// 初始化字体开关
if (typeof document !== 'undefined') {
  const serifOff = localStorage.getItem('maxma.fontSerif') === 'off'
  document.body.classList.toggle('font-sans', serifOff)
}

export function useTheme() {
  return {
    storedTheme,
    activeTheme,
    isDark,
    setTheme,
    THEMES,
  }
}
