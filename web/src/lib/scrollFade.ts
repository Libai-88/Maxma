/**
 * 滚动区边缘渐隐：让「贴着上沿的标题」和「被切掉的最后一行」看起来是渐隐，
 * 而不是生硬的一刀切。
 *
 * 为什么需要状态而不是纯 CSS：静态 `mask-image` 在**没滚动时**也会把顶部
 * 渐隐掉，等于把首屏标题永久淡掉——比不渐隐更糟。所以要按「当前能不能再
 * 往上/往下滚」来决定两侧是否加遮罩。判定逻辑是纯函数，可单测；副作用
 * 全在 `useScrollFade` 里（scroll + resize + 子节点增删三种触发源）。
 *
 * 性能：只在状态变化时写两次 dataset，滚动回调走 rAF 合并；遮罩用
 * `mask-image: none` 兜底，未滚动时不会给内容建合成层。
 */

export const SCROLL_FADE_THRESHOLD = 24

export interface ScrollEdges {
  /** 上方是否还有内容（为 true 才在顶部加渐隐） */
  fadeTop: boolean
  /** 下方是否还有内容（为 true 才在底部加渐隐） */
  fadeBottom: boolean
}

/**
 * 由滚动几何算出两侧是否该渐隐。
 *
 * `maxScroll <= 0`（内容比容器矮）时两侧都不渐隐：此时没有可滚动的内容，
 * 加遮罩只会白淡掉首行。
 */
export function computeScrollEdges(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number = SCROLL_FADE_THRESHOLD,
): ScrollEdges {
  const maxScroll = scrollHeight - clientHeight
  if (maxScroll <= 0) return { fadeTop: false, fadeBottom: false }
  return {
    fadeTop: scrollTop > threshold,
    fadeBottom: maxScroll - scrollTop > threshold,
  }
}

function applyEdges(el: HTMLElement): void {
  const { fadeTop, fadeBottom } = computeScrollEdges(el.scrollTop, el.scrollHeight, el.clientHeight)
  const top = fadeTop ? 'true' : 'false'
  const bottom = fadeBottom ? 'true' : 'false'
  // 先写再比，避免每次滚动都触发 DOM 写入
  if (el.dataset.fadeTop !== top) el.dataset.fadeTop = top
  if (el.dataset.fadeBottom !== bottom) el.dataset.fadeBottom = bottom
}

export interface ScrollFadeHandles {
  ref: (el: HTMLElement | null) => void
  /** 卸载时清掉监听；React 也会通过 ref(null) 走到这里 */
  dispose: () => void
}

/**
 * 给滚动容器挂上边缘状态（`data-fade-top` / `data-fade-bottom`）。
 *
 * 返回的 `ref` 是回调式 ref：容器可能在不同路由之间整批换掉，回调式才能
 * 在换挂载的那一刻同步绑定/解绑，不依赖 effect 的时序。
 */
export function attachScrollFade(el: HTMLElement): ScrollFadeHandles['dispose'] {
  let frame = 0
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      applyEdges(el)
    })
  }

  applyEdges(el)
  el.addEventListener('scroll', schedule, { passive: true })

  // 容器尺寸变化（窗口缩放、侧栏折叠）会改变 maxScroll
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  resize?.observe(el)

  // 内容增删（数据加载完、列表折叠）不改容器尺寸，但会改 scrollHeight
  const mutation = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(schedule)
  mutation?.observe(el, { childList: true, subtree: false })

  return () => {
    el.removeEventListener('scroll', schedule)
    resize?.disconnect()
    mutation?.disconnect()
    if (frame) cancelAnimationFrame(frame)
  }
}
