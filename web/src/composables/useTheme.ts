// web/src/composables/useTheme.ts
// 主题切换 composable — 12 选项（auto + 11 主题）
// 替代 useNightMode.ts 的主题选择职责

import { ref, computed, watch } from 'vue'

/** 主题 ID 类型 */
export type ThemeId =
  | 'auto'
  | 'warm-paper'
  | 'midnight'
  | 'high-contrast'
  | 'grass-aroma'
  | 'contemplation'
  | 'coral'
  | 'delve'
  | 'deep-think'
  | 'absolutely'
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
    id: 'midnight-contrast',
    name: '青夜·高对比',
    description: '更深青蓝，高可读',
    isDark: true,
    preview: { bg: '#26343D', accent: '#E0BFC8', text: '#F0F4F8' },
  },
]

const STORAGE_KEY = 'maxma.theme'
const DEFAULT_THEME: ThemeId = 'warm-paper'
const AUTO_LIGHT: ThemeId = 'warm-paper'
const AUTO_DARK: ThemeId = 'midnight'

/** 当前存储的主题设置（auto 或具体主题） */
const storedTheme = ref<ThemeId>(loadStoredTheme())

/** 系统是否暗色 */
const systemIsDark = ref(
  window.matchMedia('(prefers-color-scheme: dark)').matches
)

// 监听系统主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  systemIsDark.value = e.matches
})

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
  return t === 'midnight' || t === 'midnight-contrast'
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
