<template>
  <div ref="rootEl" class="canvas-card summary-card">
    <div class="card-header">
      <span class="card-title">{{ card.title }}</span>
      <button class="card-remove" @click="$emit('remove')">&times;</button>
    </div>
    <div class="card-body">{{ card.content }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { CanvasCard } from '@/types/workbench'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import { useButtonFx } from '@/composables/useButtonFx'

defineProps<{ card: CanvasCard }>()
defineEmits<{ remove: [] }>()

const rootEl = ref<HTMLElement | null>(null)

// 卡片入场：整卡浮入 + header 轻微下滑
useGsap((_ctx) => {
  const el = rootEl.value
  if (!el) return
  const q = gsap.utils.selector(el)
  gsap.timeline({ defaults: { ease: easeMap.out } })
    .fromTo(el, { autoAlpha: 0, y: 14, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.35 })
    .fromTo(q('.card-header'), { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.3 }, '<0.05')
})

// 移除按钮：危险抖动（变红由 CSS 处理）
useButtonFx(() => rootEl.value, '.card-remove', { hoverScale: 1.05, bounceIcon: false, pressScale: 0.94, danger: true })
</script>

<style scoped>
.canvas-card {
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--bg-secondary, #f8f9fa);
}

.card-title {
  font-size: 13px;
  font-weight: 600;
}

.card-remove {
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-secondary, #999);
  padding: 2px 6px;
  border-radius: 4px;
}

.card-remove:hover {
  background: color-mix(in srgb, var(--status-error, #e5484d) 12%, transparent);
  color: var(--status-error, #e5484d);
}

.card-body {
  padding: 12px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
