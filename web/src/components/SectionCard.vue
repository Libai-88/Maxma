<template>
  <div class="section-card">
    <!-- 分区头部 + 导航，合并为一行 -->
    <div class="section-header">
      <span class="section-title">{{ theme }}</span>
      <span class="section-nav">
        <button
          class="nav-link edit-btn"
          title="编辑此条目"
          @click="emitEdit"
        >&#9998;</button>
        <button
          class="nav-link"
          :disabled="currentIndex === 0"
          @click="prev"
        >←</button>
        <button
          class="nav-link"
          :disabled="currentIndex === items.length - 1"
          @click="next"
        >→</button>
      </span>
    </div>

    <!-- 条目内容 -->
    <p v-if="currentItem" class="item-text" @dblclick="emitEdit">{{ currentItem.description }}</p>
    <p v-else class="item-text item-empty">（无条目）</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { VignetteMemoryItem } from '@/types'

const props = defineProps<{
  theme: string
  items: VignetteMemoryItem[]
}>()

const emit = defineEmits<{
  (e: 'edit-item', item: { id: string; description: string; theme: string }): void
}>()

const currentIndex = ref(0)

// 监听 items 变化：当 items 数组变化（如删除/刷新后）时重置 currentIndex 防止越界
watch(
  () => props.items,
  (newItems) => {
    if (currentIndex.value >= newItems.length) {
      currentIndex.value = Math.max(0, newItems.length - 1)
    }
  },
)

const currentItem = computed<VignetteMemoryItem | undefined>(() => {
  const idx = currentIndex.value
  if (idx < 0 || idx >= props.items.length) return undefined
  return props.items[idx]
})

function prev() {
  if (currentIndex.value > 0) currentIndex.value--
}
function next() {
  if (currentIndex.value < props.items.length - 1) currentIndex.value++
}

function emitEdit() {
  const item = currentItem.value
  if (item?.id) {
    emit('edit-item', {
      id: item.id,
      description: item.description,
      theme: props.theme,
    })
  }
}
</script>

<style scoped>
.section-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

/* ── 头部行：主题 + 导航 ── */
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 0;
}
.section-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.section-nav {
  display: flex;
  gap: 2px;
}
.nav-link {
  padding: 2px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.nav-link:hover:not(:disabled) {
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.nav-link:disabled {
  opacity: 0.2;
  cursor: not-allowed;
}
.nav-link.edit-btn {
  font-size: 14px;
  opacity: 0.4;
  transition: opacity 0.15s;
}
.nav-link.edit-btn:hover {
  opacity: 1;
  color: var(--accent);
}

/* ── 内容 ── */
.item-text {
  margin: 0;
  padding: 12px 16px 16px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}
.item-empty {
  color: var(--text-secondary);
  font-style: italic;
}
</style>
