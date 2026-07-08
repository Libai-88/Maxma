// web/src/composables/useNightMode.ts
// 兼容层 — 将旧的 isNightMode API 委托给 useTheme
// StickerInline.vue 等组件仍可使用 useNightModeState()

import { computed } from 'vue'
import { useTheme } from '@/composables/useTheme'

export function useNightModeState() {
  const { isDark } = useTheme()
  return { isNightMode: isDark }
}

export function useNightModeClock() {
  const { isDark } = useTheme()
  return {
    isNightMode: isDark,
    nightModeSetting: computed(() => 'auto'),
    isLateNight: isDark,
  }
}
