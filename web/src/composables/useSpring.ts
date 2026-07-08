// web/src/composables/useSpring.ts

/** Spring 物理动画配置（与 motion 库 spring preset 对齐） */
interface SpringTransition {
  type: 'spring'
  stiffness: number
  damping: number
  mass: number
}

/** 纸质弹簧：通用默认。适度过冲，快速稳定。 */
const paper: SpringTransition = {
  type: 'spring',
  stiffness: 500,
  damping: 38,
  mass: 0.8,
}

/** 纸质柔和：大面板、模态、侧栏。过冲更轻，稳定更缓。 */
const paperGentle: SpringTransition = {
  type: 'spring',
  stiffness: 350,
  damping: 34,
  mass: 1.0,
}

/** 纸质利落：菜单、tooltip、小元素。过冲极轻，响应最快。 */
const paperSnap: SpringTransition = {
  type: 'spring',
  stiffness: 600,
  damping: 40,
  mass: 0.6,
}

export const spring = { paper, paperGentle, paperSnap } as const

/** 与 CSS 变量对齐的时长 token，混合场景保证一致 */
export const motionDuration = {
  instant: 0.08,
  fast: 0.18,
  normal: 0.28,
  slow: 0.4,
} as const

/** 常用 CSS transition 字符串（非 spring 场景） */
export const cssTransition = {
  instant: `all var(--duration-instant) var(--ease-out)`,
  fast: `all var(--duration-fast) var(--ease-out)`,
  slow: `all var(--duration-slow) var(--ease-out)`,
} as const

export function useSpring() {
  return { spring, motionDuration, cssTransition }
}
