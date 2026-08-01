import { watch } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'

export interface ViewEntranceOptions {
  /** 头部选择器（相对根容器）；不传则跳过 header 动画 */
  header?: string
  /** 内容块选择器，逐块 stagger 上浮；不传则仅 header 动画 */
  blocks?: string
  duration?: number
}

/**
 * 视图整体入场编排：header 下滑展开 + 内容块 stagger 上浮淡入。
 *
 * 安全设计：
 * - 只对 header/blocks 子元素动画，**绝不对根容器隐藏**——动画异常时页面保证可见（功能零回归）。
 * - 用 fromTo + autoAlpha（结束 autoAlpha:1 确保可见），overwrite 防与路由转场冲突。
 * - 创建在 useGsap context 内随卸载自动 revert；数据异步加载用 ready 延迟触发。
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
      const tl = gsap.timeline({ defaults: { ease: easeMap.out, duration, overwrite: 'auto' } })
      const h = header ? el.querySelector<HTMLElement>(header) : null
      if (h) {
        tl.fromTo(h, { autoAlpha: 0, y: -16 }, { autoAlpha: 1, y: 0, duration: 0.4 })
      }
      if (blocks) {
        const targets = gsap.utils.toArray<HTMLElement>(blocks, el)
        if (targets.length) {
          tl.fromTo(
            targets,
            { autoAlpha: 0, y: 18 },
            { autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.05 },
            h ? '<0.1' : 0,
          )
        }
      }
      // header 与 blocks 都无目标时不播动画，保持默认可见，不 fallback 到根容器。
      if (tl.duration() === 0) done = false
    })

    if (ready) {
      watch(ready, (ok) => { if (ok) play() }, { immediate: true, flush: 'post' })
    } else {
      play()
    }
  })
}
