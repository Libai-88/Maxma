<template>
  <div class="message-row" :class="role">
    <div class="bubble" :class="role">
      <div
        class="bubble-content"
        :class="{ collapsed: isCollapsed }"
        ref="contentEl"
      >
        <RenderMarkdown v-if="content" :content="content" />
      </div>
      <button
        v-if="isCollapsible"
        class="collapse-toggle"
        @click="isCollapsed = !isCollapsed"
      >
        {{ isCollapsed ? '展开' : '收起' }}
      </button>
      <div v-if="refs?.length" class="ref-chips">
        <ReferenceChip
          v-for="(r, idx) in refs"
          :key="idx"
          :chip="r"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import type { ParsedRef } from '@/utils/references'
import ReferenceChip from './ReferenceChip.vue'
import RenderMarkdown from './RenderMarkdown.vue'

const props = defineProps<{ role: 'user' | 'assistant'; content: string; refs?: ParsedRef[] }>()

const isCollapsed = ref(true)
const contentEl = ref<HTMLElement | null>(null)
const contentHeight = ref(0)

const isCollapsible = computed(() => contentHeight.value > 500)

function measureHeight() {
  if (contentEl.value) {
    contentHeight.value = contentEl.value.scrollHeight
  }
}

onMounted(() => {
  // 延迟测量，等待 Markdown 渲染完成
  requestAnimationFrame(measureHeight)
})

watch(() => props.content, () => {
  requestAnimationFrame(measureHeight)
})
</script>

<style scoped>
.message-row {
  display: flex;
  padding: 4px 0;
}
.message-row.user {
  justify-content: flex-end;
}
.message-row.assistant {
  justify-content: flex-start;
}
.bubble {
  max-width: 72%;
  padding: 10px 16px;
  border-radius: 14px;
  font-size: 16px;
  line-height: 1.6;
  word-break: break-word;
  box-shadow: var(--shadow);
}
.bubble.user {
  background: var(--user-bubble);
  color: var(--text-primary);
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-bottom-right-radius: 4px;
}
.bubble.assistant {
  background: var(--bg-card);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
}

/* ── 大输出折叠 ── */
.bubble-content {
  overflow: hidden;
  transition: max-height 0.35s cubic-bezier(0, 0.3, 0, 1);
}
.bubble-content.collapsed {
  max-height: 400px;
  position: relative;
}
.bubble-content.collapsed::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 60px;
  background: linear-gradient(transparent, var(--bg-card));
  pointer-events: none;
}
.bubble.user .bubble-content.collapsed::after {
  background: linear-gradient(transparent, var(--user-bubble));
}
.collapse-toggle {
  display: block;
  margin: 6px auto 0;
  padding: 2px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.collapse-toggle:hover {
  color: var(--text-primary);
  border-color: var(--text-secondary);
}

.ref-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
}
</style>
