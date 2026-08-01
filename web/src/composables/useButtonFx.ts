import { watch, nextTick, type WatchSource } from 'vue'
import { gsap, useGsap } from '@/composables/useGsap'

export interface ButtonFxOptions {
  /** hover 弹性缩放（默认 1.08） */
  hoverScale?: number
  /** hover 图标弹性蹦跳 */
  bounceIcon?: boolean
  /** 点击按压缩放（默认 0.92） */
  pressScale?: number
  /** 磁吸强度；0 关闭 */
  magnetic?: number
  /** 危险/移除按钮：hover 轻微左倾抖动提示 */
  danger?: boolean
  /** 点击后若进入选中态（.active）做一次 scale pop（back.out(2.5)） */
  clickPop?: boolean
  /**
   * 状态源：任一变化时重新绑定按钮（覆盖异步渲染 / v-if / v-for 切换场景）。
   * 同一节点通过 WeakSet 去重，不会重复挂监听；销毁的节点自动回收。
   */
  watchSources?: WatchSource[]
}

/**
 * 单个按钮的交互动效（useButtonFx 的底层实现，亦供动态挂载场景直接调用）。
 * hover 弹性放大 + 图标蹦跳 + 按压收缩 + 可选磁吸 / 危险左倾抖动。
 * 返回清理函数；事件监听一律由此移除，调用方负责注册清理。
 */
export function attachButtonFx(btn: HTMLElement, options: ButtonFxOptions = {}): () => void {
  const {
    hoverScale = 1.08,
    bounceIcon = true,
    pressScale = 0.92,
    magnetic = 0,
    danger = false,
    clickPop = false,
  } = options

  // CSS `transition: transform/all` 会插值干扰 GSAP 逐帧 transform：剔除 transform，保留其他过渡
  const cs = getComputedStyle(btn)
  const tp = cs.transitionProperty
  if (tp && tp !== 'none' && cs.transitionDuration !== '0s' && (tp.includes('all') || tp.includes('transform'))) {
    btn.style.transitionProperty = 'background, border-color, color, opacity, box-shadow, filter'
    btn.style.transitionDuration = cs.transitionDuration
    btn.style.transitionTimingFunction = cs.transitionTimingFunction
    btn.style.transitionDelay = cs.transitionDelay
  }

  const isOff = () => (btn as HTMLButtonElement).disabled
  const icon = btn.querySelector('.icon svg, svg') as SVGSVGElement | null
  const setScale = (s: number) => gsap.to(btn, { scale: s, duration: 0.25, ease: 'back.out(2)', overwrite: 'auto' })

  const dangerShake = () => {
    gsap.to(btn, {
      keyframes: [
        { rotation: -8, duration: 0.07 },
        { rotation: 7, duration: 0.09 },
        { rotation: -5, duration: 0.09 },
        { rotation: 0, duration: 0.12 },
      ],
      ease: 'power1.inOut',
      overwrite: 'auto',
    })
  }

  const onEnter = () => {
    if (isOff()) return
    setScale(hoverScale)
    if (danger) {
      dangerShake()
      return
    }
    if (bounceIcon && icon) {
      gsap.fromTo(icon, { scale: 1, rotation: 0 }, {
        scale: 1.3, rotation: 8, duration: 0.3, ease: 'elastic.out(1, 0.5)',
        yoyo: true, repeat: 1,
      })
    }
  }
  const onLeave = () => {
    setScale(1)
    if (danger) gsap.to(btn, { rotation: 0, duration: 0.2, ease: 'back.out(2)', overwrite: 'auto' })
  }
  const onDown = () => {
    if (isOff()) return
    gsap.to(btn, { scale: pressScale, duration: 0.12, ease: 'power2.out', overwrite: 'auto' })
  }
  const onUp = () => {
    if (isOff()) return
    setScale(hoverScale)
  }

  btn.addEventListener('mouseenter', onEnter)
  btn.addEventListener('mouseleave', onLeave)
  btn.addEventListener('mousedown', onDown)
  btn.addEventListener('mouseup', onUp)

  // 磁吸
  let magnetCleanup: (() => void) | null = null
  if (magnetic > 0 && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const xTo = gsap.quickTo(btn, 'x', { duration: 0.35, ease: 'power3' })
    const yTo = gsap.quickTo(btn, 'y', { duration: 0.35, ease: 'power3' })
    const onMove = (e: MouseEvent) => {
      if (isOff()) { xTo(0); yTo(0); return }
      const r = btn.getBoundingClientRect()
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
      xTo(nx * magnetic)
      yTo(ny * magnetic)
    }
    const onLeaveMagnet = () => { xTo(0); yTo(0) }
    btn.addEventListener('mousemove', onMove)
    btn.addEventListener('mouseleave', onLeaveMagnet)
    magnetCleanup = () => {
      btn.removeEventListener('mousemove', onMove)
      btn.removeEventListener('mouseleave', onLeaveMagnet)
    }
  }

  // 选中态：点击后若进入 .active 做一次 scale pop（back.out(2.5)）
  let clickPopCleanup: (() => void) | null = null
  if (clickPop) {
    const onClick = () => {
      nextTick(() => {
        if (btn.classList.contains('active')) {
          gsap.fromTo(btn, { scale: 1 }, { scale: 1.15, duration: 0.3, ease: 'back.out(2.5)', overwrite: 'auto' })
        }
      })
    }
    btn.addEventListener('click', onClick)
    clickPopCleanup = () => btn.removeEventListener('click', onClick)
  }

  return () => {
    btn.removeEventListener('mouseenter', onEnter)
    btn.removeEventListener('mouseleave', onLeave)
    btn.removeEventListener('mousedown', onDown)
    btn.removeEventListener('mouseup', onUp)
    magnetCleanup?.()
    clickPopCleanup?.()
  }
}

/**
 * 按钮交互动效：hover 弹性放大 + 图标蹦跳 + 按压收缩 + 可选磁吸 / 危险抖动。
 * 事件监听注册到 ctx 清理；reduced-motion 自动降级（useGsap 全局收口）。
 * 选择器仅作用在 target 根容器内（gsap.utils.selector），不污染外部。
 */
export function useButtonFx(
  target: () => HTMLElement | null,
  selector: string,
  options: ButtonFxOptions = {},
) {
  const { watchSources } = options

  useGsap((ctx, contextSafe) => {
    const bound = new WeakSet<HTMLElement>()

    const bind = contextSafe(() => {
      const el = target()
      if (!el) return
      const btns = gsap.utils.toArray<HTMLElement>(selector, el)
      if (!btns.length) return

      btns.forEach((btn) => {
        if (bound.has(btn)) return
        bound.add(btn)
        const cleanup = attachButtonFx(btn, options)
        ctx.add(cleanup)
      })
    })

    if (watchSources && watchSources.length) {
      watch(watchSources, () => bind(), { immediate: true, flush: 'post' })
    } else {
      bind()
    }
  })
}
