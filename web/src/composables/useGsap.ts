import { onMounted, onUnmounted } from 'vue'
import { gsap } from 'gsap'

type AnyFn = (...args: any[]) => any

// 按需懒加载的插件表（gsap-frameworks skill 推荐：不常用的插件不进初始 bundle）
const pluginMap = {
  ScrollTrigger: () => import('gsap/ScrollTrigger'),
  Flip: () => import('gsap/Flip'),
  Observer: () => import('gsap/Observer'),
  ScrollToPlugin: () => import('gsap/ScrollToPlugin'),
  SplitText: () => import('gsap/SplitText'),
} as const

type PluginName = keyof typeof pluginMap

/**
 * 懒加载并注册 GSAP 插件，返回该插件模块（调用方在需要处 await）。
 * 例：const { SplitText } = await lazyLoadPlugin('SplitText')
 */
export async function lazyLoadPlugin<K extends PluginName>(name: K): Promise<any> {
  const m: Record<string, any> = await pluginMap[name]()
  const plugin = m[name]
  gsap.registerPlugin(plugin)
  return plugin
}

let reducedMotionRegistered = false
function ensureReducedMotion() {
  if (reducedMotionRegistered) return
  reducedMotionRegistered = true
  // 全局 prefers-reduced-motion 收口：reduce 时所有 GSAP 动画近乎瞬时完成
  gsap.matchMedia().add('(prefers-reduced-motion: reduce)', () => {
    gsap.globalTimeline.timeScale(1000)
    return () => gsap.globalTimeline.timeScale(1)
  })
}

export interface UseGsapOptions {
  scope?: () => HTMLElement | null
}

type ContextSafe = <T extends AnyFn>(fn: T) => T

/**
 * Vue 3 GSAP composable（gsap-frameworks 官方模式封装）：
 *  - setup 在 onMounted 内执行，此时 DOM 已挂载，selector/ref 均可安全访问
 *  - setup 内同步创建的动画自动记录进 context
 *  - watch / 事件 / nextTick 等异步回调里的动画必须用 contextSafe 包裹，
 *    否则不会随 ctx.revert() 撤销
 *  - onUnmounted 自动 ctx.revert()，无内存泄漏
 */
export function useGsap(
  setup: (ctx: gsap.Context, contextSafe: ContextSafe) => void,
  options: UseGsapOptions = {},
) {
  ensureReducedMotion()
  let ctx: gsap.Context | null = null
  let safe: ContextSafe | undefined

  onMounted(() => {
    if (ctx) return
    // contextSafe 由 gsap.context 作为回调第二参数传入（官方签名）
    ctx = gsap.context((c, contextSafe) => {
      safe = contextSafe as ContextSafe
      setup(c, contextSafe as ContextSafe)
    }, options.scope?.() ?? undefined)
  })

  onUnmounted(() => {
    ctx?.revert()
    ctx = null
    safe = undefined
  })

  const contextSafe: ContextSafe = ((fn: any) =>
    (safe ? safe(fn) : fn)) as ContextSafe

  return { contextSafe, getContext: () => ctx }
}

/** 与 tokens.css 动效 token 对齐的 GSAP 缓动映射 */
export const easeMap = {
  out: 'power3.out',
  in: 'power3.in',
  standard: 'power2.inOut',
  smooth: 'power2.out',
  drawer: 'power3.out',
  spring: 'back.out(1.7)',
} as const

export const durationMap = {
  instant: 0.1,
  fast: 0.15,
  slow: 0.25,
} as const

export { gsap }
