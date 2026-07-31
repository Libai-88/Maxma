import { watch } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'

export interface ViewEntranceOptions {
  /** 头部选择器（相对根容器）；不传则跳过 header 动画 */
  header?: string
  /** 内容块选择器，逐块 stagger 上浮；不传则整体淡入 */
  blocks?: string
  duration?: number
}

/**
 * 视图整体入场编排：header 下滑展开 + 内容块 stagger 上浮淡入。
 * 作用于 view 根容器（例：`.settings-view`），创建在 useGsap context 内随卸载自动 revert。
 * 数据异步加载时通过 ready 延迟触发。
 */
export function useViewEntrance(
  root: () => HTMLElement | null,
  options: ViewEntranceOptions & { ready?: () => boolean } = {},
) {
  const { header, blocks, duration = 0.5, ready } = options

  useGsap((_ctx, contextSafe) => {
    let done = false
    const play = contextSafe(() => {
      const el = root()
      if (!el || done) return
      done = true
      const tl = gsap.timeline({ defaults: { ease: easeMap.out, duration } })
      if (header) {
        const h = el.querySelector<HTMLElement>(header)
        if (h) tl.from(h, { opacity: 0, y: -16, duration: 0.4 })
      }
      if (blocks) {
        const targets = gsap.utils.toArray<HTMLElement>(blocks, el)
        if (targets.length) {
          tl.from(targets, { opacity: 0, y: 18, duration: 0.45, stagger: 0.05 }, header ? '<0.1' : 0)
        } else {
          tl.from(el, { opacity: 0, y: 10 })
        }
      } else {
        tl.from(el, { opacity: 0, y: 10 }, header ? '<0.1' : 0)
      }
    })

    if (ready) {
      watch(ready, (ok) => { if (ok) play() }, { immediate: true, flush: 'post' })
    } else {
      play()
    }
  })
}
