import { watch } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'

export interface RevealOptions {
  /** 就绪条件：返回 true 才播放入场（如数据加载完成） */
  ready?: () => boolean
  duration?: number
  stagger?: number
  y?: number
}

/**
 * 通用入场揭示：就绪条件满足后，对容器内 selector 匹配元素做一次 stagger 上浮淡入。
 * 例：useReveal(() => cardGridRef.value, '.news-card', { ready: () => !loading.value })
 * 动画创建在 useGsap context 内，随组件卸载自动 revert。
 */
export function useReveal(
  container: () => HTMLElement | null,
  selector: string,
  opts: RevealOptions = {},
) {
  const { duration = 0.35, stagger = 0.05, y = 12 } = opts

  useGsap((_ctx, contextSafe) => {
    watch(() => (opts.ready ? opts.ready() : true) && container() !== null, contextSafe((ok) => {
      if (!ok) return
      const el = container()
      if (!el) return
      const targets = gsap.utils.toArray<HTMLElement>(selector, el)
      if (!targets.length) return
      gsap.from(targets, { opacity: 0, y, duration, ease: easeMap.out, stagger })
    }), { immediate: true, flush: 'post' })
  })
}
