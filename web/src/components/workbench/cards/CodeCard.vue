<template>
  <div ref="rootEl" class="canvas-card code-card">
    <div class="card-header">
      <Icon class="card-icon" name="python" :size="16" />
      <span class="card-title">{{ card.title }}</span>
      <span v-if="card.sourceTool" class="card-source">{{ card.sourceTool }}</span>
      <button class="card-copy" @click="copyCode" title="复制代码">
        <Icon :name="copied ? 'checkmark' : 'copy'" :size="12" />
      </button>
      <button class="card-remove" @click="$emit('remove')" title="移除">&times;</button>
    </div>
    <pre class="card-code"><code>{{ card.content }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { CanvasCard } from '@/types/workbench'
import Icon from '@/components/Icon.vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import { useButtonFx } from '@/composables/useButtonFx'

const props = defineProps<{ card: CanvasCard }>()
defineEmits<{ remove: [] }>()

const copied = ref(false)
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

// 复制按钮：hover 弹性 + 图标蹦跳；移除按钮：危险抖动（变红由 CSS 处理）
useButtonFx(() => rootEl.value, '.card-copy', { hoverScale: 1.08, bounceIcon: true, pressScale: 0.92 })
useButtonFx(() => rootEl.value, '.card-remove', { hoverScale: 1.05, bounceIcon: false, pressScale: 0.94, danger: true })

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.card.content)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* ignore */ }
}
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
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--bg-secondary, #f8f9fa);
}

.card-icon {
  font-size: 14px;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  flex: 1;
}

.card-source {
  font-size: 10px;
  color: var(--text-secondary, #999);
  background: var(--bg-hover, #f0f0f0);
  padding: 2px 6px;
  border-radius: 4px;
}

.card-copy, .card-remove {
  border: none;
  background: transparent;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-secondary, #999);
  padding: 2px 6px;
  border-radius: 4px;
}

.card-copy:hover, .card-remove:hover {
  background: var(--bg-hover, #f0f0f0);
}

.card-remove:hover {
  background: color-mix(in srgb, var(--status-error, #e5484d) 12%, transparent);
  color: var(--status-error, #e5484d);
}

.card-code {
  padding: 12px;
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  overflow-x: auto;
  margin: 0;
  line-height: 1.5;
  color: var(--text-primary, #333);
}
</style>
