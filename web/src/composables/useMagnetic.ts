import { gsap, useGsap } from '@/composables/useGsap'

export interface MagneticOptions {
  /** 吸附强度（px） */
  strength?: number
  /** 跟随缓动时长 */
  duration?: number
}

/**
 * 磁吸微交互：鼠标靠近元素时吸附跟随、移出回弹（品牌签名手感）。
 * quickTo 复用单 tween 高频更新；事件监听注册到 ctx.add 卸载时清理。
 * reduced-motion 下不启用磁吸。
 */
export function useMagnetic(
  target: () => HTMLElement | null,
  options: MagneticOptions = {},
) {
  const { strength = 12, duration = 0.35 } = options

  useGsap((ctx) => {
    const el = target()
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const xTo = gsap.quickTo(el, 'x', { duration, ease: 'power3' })
    const yTo = gsap.quickTo(el, 'y', { duration, ease: 'power3' })
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
      xTo(nx * strength)
      yTo(ny * strength)
    }
    const onLeave = () => {
      xTo(0)
      yTo(0)
    }
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    ctx.add(() => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    })
  })
}
