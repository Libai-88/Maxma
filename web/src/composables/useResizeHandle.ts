/**
 * useResizeHandle — 输入框拖拽调整高度逻辑
 *
 * 从 ChatInput.vue 提取的纯逻辑 composable。
 * 管理 pointer capture 拖拽、CSSOM 高度设置、初始高度捕获。
 */
import { ref, watchEffect, onMounted, nextTick, type Ref } from 'vue'

const DEFAULT_INPUT_HEIGHT = 117

export function useResizeHandle(
  inputContainerRef: Ref<HTMLElement | null>,
  textareaRef: Ref<HTMLTextAreaElement | null>,
) {
  const customHeight = ref<number | null>(null)
  const isResizing = ref(false)
  const resizeStartY = ref(0)
  const resizeStartHeight = ref(0)
  const handleRef = ref<HTMLDivElement | null>(null)
  const initialHeight = ref(DEFAULT_INPUT_HEIGHT)
  let activePointerId = -1

  // CSP-safe CSSOM: set container height/minHeight via style.setProperty
  watchEffect(() => {
    const el = inputContainerRef.value
    if (!el) return
    el.style.setProperty('min-height', `${initialHeight.value}px`)
    if (customHeight.value !== null) {
      el.style.setProperty('height', `${customHeight.value}px`)
    } else {
      el.style.removeProperty('height')
    }
  }, { flush: 'post' })

  // 组件挂载后捕获输入框的初始默认高度，作为拖拽下限
  onMounted(() => {
    nextTick(() => {
      const el = inputContainerRef.value
      if (el) initialHeight.value = Math.max(DEFAULT_INPUT_HEIGHT, el.clientHeight)
    })
  })

  function startResize(e: PointerEvent) {
    const handle = e.currentTarget as HTMLDivElement
    handle.setPointerCapture(e.pointerId)
    handleRef.value = handle
    activePointerId = e.pointerId

    isResizing.value = true
    resizeStartY.value = e.clientY
    const el = inputContainerRef.value
    resizeStartHeight.value = el ? el.clientHeight : initialHeight.value
    if (customHeight.value === null) {
      customHeight.value = resizeStartHeight.value
    }

    // 拖拽时清除 textarea 行内高度，让 CSS height: 100% 接管以填充容器
    if (textareaRef.value) textareaRef.value.style.height = ''

    handle.addEventListener('pointermove', onResizeMove)
    handle.addEventListener('pointerup', onResizeEnd)
    handle.addEventListener('pointercancel', onResizeEnd)
  }

  function onResizeMove(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return
    const delta = resizeStartY.value - e.clientY
    const newHeight = Math.max(initialHeight.value, Math.min(600, resizeStartHeight.value + delta))
    customHeight.value = newHeight
  }

  function onResizeEnd(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return
    isResizing.value = false
    const handle = handleRef.value
    if (handle) {
      handle.releasePointerCapture(e.pointerId)
      handle.removeEventListener('pointermove', onResizeMove)
      handle.removeEventListener('pointerup', onResizeEnd)
      handle.removeEventListener('pointercancel', onResizeEnd)
      handleRef.value = null
      activePointerId = -1
    }
  }

  return {
    customHeight,
    isResizing,
    initialHeight,
    startResize,
  }
}
