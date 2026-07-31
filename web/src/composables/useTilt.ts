import { gsap, useGsap } from '@/composables/useGsap'

/**
 * 3D 倾斜 hover 效果：鼠标位置驱动 rotationX/rotationY（quickTo 平滑跟手）。
 * 例：useTilt(() => rootEl.value)
 * quickTo 在 onMounted 同步创建，随 ctx.revert() 清理。
 */
export function useTilt(
  target: () => HTMLElement | null,
  options: { strength?: number; perspective?: number } = {},
) {
  const { strength = 7, perspective = 700 } = options

  useGsap(() => {
    const el = target()
    if (!el) return
    gsap.set(el, { transformPerspective: perspective })
    const rxTo = gsap.quickTo(el, 'rotationX', { duration: 0.35, ease: 'power2' })
    const ryTo = gsap.quickTo(el, 'rotationY', { duration: 0.35, ease: 'power2' })
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      ryTo(px * strength)
      rxTo(-py * strength)
    })
    el.addEventListener('mouseleave', () => {
      rxTo(0)
      ryTo(0)
    })
  })
}
