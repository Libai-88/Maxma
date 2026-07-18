// web/src/composables/useFloatSidebar.ts
import { onUnmounted, ref } from 'vue'

const HOVER_DELAY = 200 // ms

// 模块级定时器（enter/leave 互斥清除）
let _enterTimer: ReturnType<typeof setTimeout> | null = null
let _leaveTimer: ReturnType<typeof setTimeout> | null = null

const isVisible = ref(false)

function clearEnter() {
  if (_enterTimer) { clearTimeout(_enterTimer); _enterTimer = null }
}
function clearLeave() {
  if (_leaveTimer) { clearTimeout(_leaveTimer); _leaveTimer = null }
}

function clearAllTimers() {
  clearEnter()
  clearLeave()
}

function onEnter() {
  // 进入时取消正在进行的 leave 延迟
  clearLeave()
  if (isVisible.value) return
  _enterTimer = setTimeout(() => {
    isVisible.value = true
    _enterTimer = null
  }, HOVER_DELAY)
}

function onLeave() {
  // 离开时取消正在进行的 enter 延迟
  clearEnter()
  if (!isVisible.value) return
  _leaveTimer = setTimeout(() => {
    isVisible.value = false
    _leaveTimer = null
  }, HOVER_DELAY)
}

function forceClose() {
  clearAllTimers()
  isVisible.value = false
}

export function useFloatSidebar() {
  onUnmounted(() => {
    clearAllTimers()
  })

  return { isVisible, onEnter, onLeave, forceClose }
}
