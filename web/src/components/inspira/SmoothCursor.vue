<template>
  <div ref="cursorRef" v-if="visible" class="smooth-cursor" aria-hidden="true" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { gsap, useGsap } from '@/composables/useGsap'

export interface SpringConfig {
  damping?: number
  stiffness?: number
  mass?: number
}

const props = withDefaults(defineProps<{
  springConfig?: SpringConfig
}>(), {
  springConfig: () => ({ damping: 0.5, stiffness: 0.2, mass: 0.1 }),
})

const cursorRef = ref<HTMLElement | null>(null)
const visible = ref(true)

useGsap((ctx) => {
  // 1. 尊重用户 motion 偏好
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    visible.value = false
    return
  }
  // 2. 触屏设备禁用（无鼠标指针）
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    visible.value = false
    return
  }

  const el = cursorRef.value
  if (!el) return

  // 将弹簧物理参数映射为 GSAP 持续时间和缓动
  const { damping = 0.5, stiffness = 0.2, mass = 0.1 } = props.springConfig
  // 高 stiffness → 更短持续时间（响应更快）
  // 高 mass → 更长持续时间（更沉重）
  // 高 damping → 更少回弹超调
  const duration = 0.15 + (1 - stiffness) * 0.4 + mass * 0.2
  const overshoot = Math.max(0, (1 - damping) * 1.5)
  const ease = overshoot > 0.01 ? `back.out(${overshoot.toFixed(2)})` : 'power3.out'

  const xTo = gsap.quickTo(el, 'x', { duration, ease })
  const yTo = gsap.quickTo(el, 'y', { duration, ease })

  const onMove = (e: MouseEvent) => {
    xTo(e.clientX)
    yTo(e.clientY)
  }

  // 隐藏默认光标
  document.body.style.cursor = 'none'
  ctx.add(() => { document.body.style.cursor = '' })

  window.addEventListener('mousemove', onMove)
  ctx.add(() => window.removeEventListener('mousemove', onMove))
})
</script>

<style scoped>
.smooth-cursor {
  position: fixed;
  top: 0;
  left: 0;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  pointer-events: none;
  z-index: 9999;
  background: var(--accent);
  box-shadow:
    0 0 6px  color-mix(in srgb, var(--accent) 50%, transparent),
    0 0 16px color-mix(in srgb, var(--accent) 25%, transparent);
  will-change: transform;
}
</style>