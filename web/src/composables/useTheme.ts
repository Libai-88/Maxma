// web/src/composables/useTheme.ts
// 主题切换 composable — 13 选项（auto + 12 主题）
// 替代 useNightMode.ts 的主题选择职责

import { ref, computed, watch } from 'vue'

/** 主题 ID 类型 */
export type ThemeId =
  | 'auto'
  | 'warm-paper'
  | 'warm-precision'
  | 'study'
  | 'midnight'
  | 'high-contrast'
  | 'grass-aroma'
  | 'contemplation'
  | 'coral'
  | 'delve'
  | 'deep-think'
  | 'absolutely'
  | 'dawn'
  | 'midnight-contrast'

/** 主题元信息 */
export interface ThemeMeta {
  id: ThemeId
  name: string
  description: string
  isDark: boolean
  preview: { bg: string; accent: string; text: string }
}

/** 全部主题元信息（供 ThemePicker 渲染） */
export const THEMES: ThemeMeta[] = [
  {
    id: 'auto',
    name: '自动',
    description: '跟随系统明暗',
    isDark: false,
    preview: { bg: 'linear-gradient(135deg, #F8F4ED 50%, #3B4A54 50%)', accent: '#537D96', text: '#3B3D3F' },
  },
  {
    id: 'warm-paper',
    name: '暖纸',
    description: '和纸手抄本，温润文人感',
    isDark: false,
    preview: { bg: '#F8F4ED', accent: '#537D96', text: '#3B3D3F' },
  },
  {
    id: 'warm-precision',
    name: '暖精工',
    description: '暖奶油 + 赤陶，精准温暖',
    isDark: false,
    preview: { bg: '#FCF9F5', accent: '#C17A5C', text: '#2C2825' },
  },
  {
    id: 'study',
    name: '书斋',
    description: '暖纸 + 远山青 + 赤陶，书卷气',
    isDark: false,
    preview: { bg: '#F8F4ED', accent: '#537D96', text: '#2A2826' },
  },
  {
    id: 'midnight',
    name: '青夜',
    description: '深青蓝底，柔粉印章',
    isDark: true,
    preview: { bg: '#3B4A54', accent: '#C99AAF', text: '#E1EAF0' },
  },
  {
    id: 'high-contrast',
    name: '素白',
    description: '高对比浅色，无障碍',
    isDark: false,
    preview: { bg: '#FAF8F7', accent: '#1A3A4A', text: '#1A1A1A' },
  },
  {
    id: 'grass-aroma',
    name: '草香',
    description: '青草绿调，清晨露水',
    isDark: false,
    preview: { bg: '#F5F8F3', accent: '#5B8C5F', text: '#2D3F30' },
  },
  {
    id: 'contemplation',
    name: '沉思',
    description: '灰蓝调，雨天窗外',
    isDark: false,
    preview: { bg: '#F3F5F7', accent: '#597891', text: '#2A3340' },
  },
  {
    id: 'coral',
    name: '珊瑚',
    description: '墨蓝 + 珊瑚朱',
    isDark: false,
    preview: { bg: '#FDF6EC', accent: '#2B4858', text: '#2A2520' },
  },
  {
    id: 'delve',
    name: '极简',
    description: '冷调纯白 + 纯黑',
    isDark: false,
    preview: { bg: '#FFFFFF', accent: '#202123', text: '#202123' },
  },
  {
    id: 'deep-think',
    name: '深思',
    description: '白底 + 克制蓝紫',
    isDark: false,
    preview: { bg: '#FCFCFD', accent: '#515FDC', text: '#1A1B2E' },
  },
  {
    id: 'absolutely',
    name: '赤陶',
    description: '暖奶油 + 哑光赤陶',
    isDark: false,
    preview: { bg: '#F4F3EE', accent: '#A54B37', text: '#2E2A26' },
  },
  {
    id: 'dawn',
    name: '晨曦',
    description: '粉桃奶黄渐变，清晨薄雾',
    isDark: false,
    preview: { bg: 'linear-gradient(135deg, #FDC9C6 0%, #FFEEBB 35%, #FCFBE6 65%, #EAF5F6 100%)', accent: '#E8826F', text: '#3A3530' },
  },
  {
    id: 'midnight-contrast',
    name: '青夜·高对比',
    description: '更深青蓝，高可读',
    isDark: true,
    preview: { bg: '#26343D', accent: '#E0BFC8', text: '#F0F4F8' },
  },
]

const STORAGE_KEY = 'maxma.theme'
const DEFAULT_THEME: ThemeId = 'warm-precision'
const AUTO_LIGHT: ThemeId = 'warm-paper'
const AUTO_DARK: ThemeId = 'midnight'

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
