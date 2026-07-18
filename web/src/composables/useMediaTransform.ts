// web/src/composables/useMediaTransform.ts
import { ref, computed, readonly } from 'vue'

interface Transform {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 0.5
const MAX_SCALE = 8
const WHEEL_SENSITIVITY = 0.002
const DRAG_THRESHOLD = 3

export function useMediaTransform() {
  const transform = ref<Transform>({ scale: 1, x: 0, y: 0 })
  const isDragging = ref(false)

  let dragStartX = 0
  let dragStartY = 0
  let dragStartTx = 0
  let dragStartTy = 0
  const hasMoved = ref(false)

  const transformStyle = computed(() =>
    `translate(${transform.value.x}px, ${transform.value.y}px) scale(${transform.value.scale})`
  )

  function reset() {
    transform.value = { scale: 1, x: 0, y: 0 }
  }

  /** 计算适应窗口的缩放比例 */
  function computeFitScale(naturalW: number, naturalH: number, viewW: number, viewH: number) {
    const scaleX = viewW / naturalW
    const scaleY = viewH / naturalH
    return Math.min(scaleX, scaleY, 1)
  }

  function setScale(scale: number) {
    transform.value.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
  }

  /** 滚轮缩放，以鼠标位置为中心 */
  function onWheel(e: WheelEvent, containerEl: HTMLElement) {
    e.preventDefault()
    const delta = e.deltaY
    // factor = exp(-delta * sensitivity) → 向上滚 delta<0 → factor>1 放大
    const factor = Math.exp(-delta * WHEEL_SENSITIVITY)
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, transform.value.scale * factor))

    // 以鼠标位置为缩放中心
    const rect = containerEl.getBoundingClientRect()
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2

    const ratio = newScale / transform.value.scale
    transform.value.x = cx - (cx - transform.value.x) * ratio
    transform.value.y = cy - (cy - transform.value.y) * ratio
    transform.value.scale = newScale
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    isDragging.value = true
    hasMoved.value = false
    dragStartX = e.clientX
    dragStartY = e.clientY
    dragStartTx = transform.value.x
    dragStartTy = transform.value.y
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging.value) return
    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      hasMoved.value = true
    }
    transform.value.x = dragStartTx + dx
    transform.value.y = dragStartTy + dy
  }

  function onPointerUp(e: PointerEvent) {
    isDragging.value = false
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  /** 双击：在 fit 和 1x 之间切换 */
  function onDoubleClick(fitScale: number) {
    if (transform.value.scale > fitScale * 1.1) {
      // 已放大超出 fit → 回到 fit
      transform.value = { scale: fitScale, x: 0, y: 0 }
    } else {
      // 在 fit 或更小 → 放大到 1x
      transform.value = { scale: 1, x: 0, y: 0 }
    }
  }

  /** 键盘缩放 */
  function onKeyZoom(key: string) {
    if (key === '+' || key === '=') setScale(transform.value.scale * 1.2)
    else if (key === '-') setScale(transform.value.scale / 1.2)
    else if (key === '0') reset()
  }

  return {
    transform,
    isDragging,
    transformStyle,
    hasMoved: readonly(hasMoved),
    reset,
    computeFitScale,
    setScale,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    onKeyZoom,
  }
}
