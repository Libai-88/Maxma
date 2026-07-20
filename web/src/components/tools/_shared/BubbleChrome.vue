<template>
  <div class="tool-bubble" :class="[toolCall.status, { open: isOpen }]">
    <div class="bubble-header" @click="toggle" role="button" :aria-expanded="isOpen">
      <span class="bubble-status">
        <span v-if="toolCall.status === 'running'" class="spinner"></span>
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

const props = defineProps<{ toolCall: ToolCall }>()

const isOpen = ref(false)
const bodyWrapper = ref<HTMLElement | null>(null)

const displayName = computed(() => toolDisplayName(props.toolCall.name))

function toggle() {
  if (props.toolCall.status === 'running') return
  isOpen.value = !isOpen.value
}

/** 展开气泡并设置动画高度 */
function openBody() {
  if (!bodyWrapper.value) return
  const h = bodyWrapper.value.scrollHeight
  bodyWrapper.value.style.maxHeight = h + 'px'
  setTimeout(() => {
    if (bodyWrapper.value && isOpen.value) {
      bodyWrapper.value.style.maxHeight = 'none'
    }
  }, 350)
}

watch(isOpen, (open) => {
  if (!bodyWrapper.value) return
  if (open) {
    openBody()
  } else {
    // Freeze at current height for smooth collapse
    bodyWrapper.value.style.maxHeight = bodyWrapper.value.scrollHeight + 'px'
    void bodyWrapper.value.offsetHeight
    bodyWrapper.value.style.maxHeight = '0px'
  }
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
  border-color: var(--border-strong, color-mix(in srgb, var(--accent) 20%, var(--border)));
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
  transition: background 0.12s var(--ease-out);
}
.bubble-header:hover {
  background: color-mix(in srgb, var(--accent) 4%, transparent);
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
  transition: max-height 0.3s cubic-bezier(0, 0.3, 0, 1);
}
.tool-bubble.open .bubble-body-wrapper {
  max-height: none;
}
.bubble-body {
  padding: 0 12px 12px;
  border-top: 1px solid var(--border);
}
.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--accent);
  border-top-color: transparent;
  border-radius: 50%;
  animation: tool-spin 0.6s linear infinite;
}
@keyframes tool-spin {
  to { transform: rotate(360deg); }
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
  .bubble-body-wrapper {
    transition: none;
  }
  .spinner {
    animation-duration: 1.5s;
  }
}
</style>
