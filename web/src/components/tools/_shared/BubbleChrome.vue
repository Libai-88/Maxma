<template>
  <div class="tool-bubble" :class="[toolCall.status, { open: isOpen }]">
    <div class="bubble-header" @click="toggle" role="button" :aria-expanded="isOpen">
      <span class="bubble-status">
        <span v-if="toolCall.status === 'running'" class="tool-pulse-dot"></span>
        <Icon v-else-if="toolCall.status === 'done'" name="checkmark" :size="14" />
        <Icon v-else name="close" :size="14" />
      </span>
      <span class="bubble-name">{{ displayName }}</span>
      <span class="bubble-elapsed" v-if="toolCall.elapsed !== null">
        {{ toolCall.elapsed }}s
      </span>
    </div>
    <div class="bubble-body-wrapper" ref="bodyWrapper">
      <div class="bubble-body" ref="bodyInner">
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import type { ToolCall } from '@/types'
import { toolDisplayName } from './displayNames'
import Icon from '@/components/Icon.vue'
import { gsap, useGsap, easeMap, durationMap } from '@/composables/useGsap'

const props = defineProps<{ toolCall: ToolCall }>()

const isOpen = ref(false)
const bodyWrapper = ref<HTMLElement | null>(null)

const displayName = computed(() => toolDisplayName(props.toolCall.name))

function toggle() {
  if (props.toolCall.status === 'running') return
  isOpen.value = !isOpen.value
}

// 展开/收起由 GSAP 控制（无 reflow hack、无硬编码时长、onComplete 设 none 使流式内容自适应）
useGsap((_ctx, contextSafe) => {
  const onOpenChange = contextSafe((open: boolean) => {
    const el = bodyWrapper.value
    if (!el) return
    if (open) {
      const h = el.scrollHeight
      gsap.fromTo(el,
        { maxHeight: 0, autoAlpha: 0 },
        { maxHeight: h, autoAlpha: 1, duration: durationMap.slow, ease: easeMap.out,
          overwrite: 'auto',
          onComplete: () => { el.style.maxHeight = 'none' } })
    } else {
      // 先冻结当前高度（内容可能处于 auto/流式增长中），再收起
      gsap.set(el, { maxHeight: el.scrollHeight })
      gsap.to(el, { maxHeight: 0, autoAlpha: 0, duration: durationMap.fast,
        ease: easeMap.out, overwrite: 'auto' })
    }
  })
  watch(isOpen, onOpenChange)
})

// ★ 组件挂载时若已是 running 状态，立即展开（lazy watch 不会因初始值相同而触发）
onMounted(() => {
  if (props.toolCall.status === 'running') {
    isOpen.value = true
  }
})

// 运行时状态变为 running 也展开
watch(() => props.toolCall.status, (s) => {
  if (s === 'running') {
    isOpen.value = true
  }
})

// expose nothing — parent controls via toolCall prop changes
</script>

<style scoped>
.tool-bubble {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  overflow: hidden;
  transition: border-color 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              box-shadow 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
.tool-bubble:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-sm);
}
.bubble-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 0.85em;
  color: var(--text-secondary);
  transition: background 0.12s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
.bubble-header:hover {
  background: var(--accent-light, color-mix(in srgb, var(--accent) 4%, transparent));
}
.bubble-status {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bubble-name {
  flex: 1;
  font-weight: 500;
  color: var(--text-primary);
}
.bubble-elapsed {
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
}
.bubble-body-wrapper {
  max-height: 0;
  overflow: hidden;
  /* 展开/收起由 GSAP 控制，max-height 由 GSAP 内联设置，onComplete 后设 none 自适应 */
}
.bubble-body {
  padding: 0 12px 12px;
  border-top: 1px solid var(--border);
}
/* 运行状态脉动圆点 */
.tool-pulse-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: maxma-tool-pulse 1s ease-in-out infinite;
}

/* 状态色彩 */
.tool-bubble.running {
  border-left: 3px solid var(--accent);
}
.tool-bubble.done {
  border-left: 3px solid var(--status-ok);
}
.tool-bubble.error {
  border-left: 3px solid var(--status-error);
}

/* 无障碍 */
@media (prefers-reduced-motion: reduce) {
  .bubble-body-wrapper { transition: none; }
  .tool-pulse-dot { animation: none; opacity: 0.6; }
}
</style>
