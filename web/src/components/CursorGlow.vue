<template>
  <div ref="glowRef" v-if="enabled" class="cursor-glow" aria-hidden="true" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { gsap, useGsap } from '@/composables/useGsap'

// 全局鼠标柔光跟随（quickTo 复用单 tween，平滑跟手）
const glowRef = ref<HTMLElement | null>(null)
const enabled = ref(true)

useGsap(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    enabled.value = false
    return
  }
  const el = glowRef.value
  if (!el) return
  const xTo = gsap.quickTo(el, 'x', { duration: 0.55, ease: 'power3' })
  const yTo = gsap.quickTo(el, 'y', { duration: 0.55, ease: 'power3' })
  const onMove = (e: MouseEvent) => {
    xTo(e.clientX)
    yTo(e.clientY)
  }
  window.addEventListener('mousemove', onMove)
})
</script>

<style scoped>
.cursor-glow {
  position: fixed;
  top: 0;
  left: 0;
  width: 420px;
  height: 420px;
  margin: -210px 0 0 -210px;
  border-radius: 50%;
  pointer-events: none;
  z-index: 1;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent) 7%, transparent) 0%, transparent 62%);
  will-change: transform;
}
</style>
