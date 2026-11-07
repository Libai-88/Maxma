// web/src/composables/useMotion.ts
// 动效密度偏好 — 默认「克制」，用户可在外观页切回「完整」。
// 与 usePaperTexture / useTheme 同构：模块级单例 + 安全存储 + 挂到 <html> 上，
// 让 design-system.css 的 data-motion 规则在组件挂载前就生效（无闪动）。

import { computed, ref, watch } from 'vue'
import { safeGetItem, safeSetItem } from '@/lib/storage'

export type MotionMode = 'calm' | 'full'

const STORAGE_KEY = 'maxma.motion'

const mode = ref<MotionMode>(safeGetItem(STORAGE_KEY) === 'full' ? 'full' : 'calm')

function apply(value: MotionMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.motion = value
  }
}
watch(mode, (value) => {
  safeSetItem(STORAGE_KEY, value)
  apply(value)
}, { immediate: true })

export function useMotion() {
  return {
    mode,
    calm: computed(() => mode.value === 'calm'),
    toggle() { mode.value = mode.value === 'calm' ? 'full' : 'calm' },
  }
}
