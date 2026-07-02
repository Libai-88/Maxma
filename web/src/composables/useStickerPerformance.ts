import { readonly, ref, onMounted, onUnmounted, type Ref } from 'vue'

/**
 * 表情性能优化 — 视口外动图降级。
 *
 * 浏览器不能可靠地用 CSS 暂停 animated WebP，所以这里仅负责判断可见性；
 * 渲染组件会在不可见/低 FPS 时切换到静态快照。
 */
export function useStickerPerformance(targetRef: Ref<Element | null>) {
  const isVisible = ref(true)
  let observer: IntersectionObserver | null = null

  onMounted(() => {
    if (!targetRef.value) return

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          isVisible.value = entry.isIntersecting
        }
      },
      {
        // 提前 100px 开始加载，避免用户滚动时看到卡顿
        rootMargin: '100px',
        threshold: 0.1
      }
    )

    observer.observe(targetRef.value)
  })

  onUnmounted(() => {
    if (observer) {
      observer.disconnect()
      observer = null
    }
  })

  return { isVisible }
}

/**
 * FPS 监控 — 检测性能问题并自动降级。
 *
 * 当 FPS 持续低于 30 时，触发降级模式（如暂停所有动图）。
 */
interface FPSMonitorState {
  isLowPerformance: Ref<boolean>
  consumers: number
  frameCount: number
  lastTime: number
  rafId: number | null
  threshold: number
  duration: number
}

const fpsMonitors = new Map<string, FPSMonitorState>()

function getMonitorKey(threshold: number, duration: number) {
  return `${threshold}:${duration}`
}

function getOrCreateMonitor(threshold: number, duration: number): FPSMonitorState {
  const key = getMonitorKey(threshold, duration)
  const existing = fpsMonitors.get(key)
  if (existing) return existing

  const monitor: FPSMonitorState = {
    isLowPerformance: ref(false),
    consumers: 0,
    frameCount: 0,
    lastTime: 0,
    rafId: null,
    threshold,
    duration,
  }
  fpsMonitors.set(key, monitor)
  return monitor
}

function measureSharedFPS(monitor: FPSMonitorState) {
  monitor.frameCount++
  const now = performance.now()
  const elapsed = now - monitor.lastTime

  if (elapsed >= monitor.duration) {
    const fps = (monitor.frameCount / elapsed) * 1000
    monitor.isLowPerformance.value = fps < monitor.threshold
    monitor.frameCount = 0
    monitor.lastTime = now
  }

  monitor.rafId = requestAnimationFrame(() => measureSharedFPS(monitor))
}

export function useFPSMonitor(threshold = 30, duration = 3000) {
  const monitor = getOrCreateMonitor(threshold, duration)

  onMounted(() => {
    monitor.consumers++
    if (monitor.rafId === null) {
      monitor.frameCount = 0
      monitor.lastTime = performance.now()
      monitor.rafId = requestAnimationFrame(() => measureSharedFPS(monitor))
    }
  })

  onUnmounted(() => {
    monitor.consumers = Math.max(0, monitor.consumers - 1)
    if (monitor.consumers === 0 && monitor.rafId !== null) {
      cancelAnimationFrame(monitor.rafId)
      monitor.rafId = null
      monitor.isLowPerformance.value = false
      fpsMonitors.delete(getMonitorKey(threshold, duration))
    }
  })

  return { isLowPerformance: readonly(monitor.isLowPerformance) }
}
