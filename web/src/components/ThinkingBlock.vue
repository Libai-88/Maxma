<template>
  <div class="thinking-block" :class="{ done: block.done }">
    <div class="thinking-header">
      <span class="thinking-label">
        <span class="spinner" v-if="!block.done"></span>
        思考中{{ block.done ? '（完成）' : '……' }}
      </span>
    </div>
    <div class="thinking-body" v-if="block.tokens">
      <div class="thinking-content">
        <template v-if="block.becameAnswer">
          <template v-for="(seg, i) in segments" :key="i">
            <RenderMarkdown v-if="seg.type === 'text'" :content="seg.text" />
            <span v-else class="sticker-inline">
              <img :src="seg.src" class="sticker-img" loading="lazy" />
            </span>
          </template>
        </template>
        <RenderMarkdown v-else :content="block.tokens" :streaming="!block.done" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ThinkingBlock as ThinkingBlockType } from '@/types'
import RenderMarkdown from './RenderMarkdown.vue'

const props = defineProps<{ block: ThinkingBlockType }>()

const segments = computed(() => {
  const text = props.block.tokens
  if (!text) return []
  const regex = /<sticker:([^>]+)>/g
  const segs: Array<{ type: 'text'; text: string } | { type: 'sticker'; src: string }> = []
  let lastIndex = 0
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segs.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }
    segs.push({ type: 'sticker', src: `/api/stickers/${match[1]}` })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    segs.push({ type: 'text', text: text.slice(lastIndex) })
  }
  return segs
})
</script>

<style scoped>
.thinking-block {
  margin: 8px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  overflow: hidden;
  transition: all 0.4s ease;
}
.thinking-block.done {
  background: var(--bg-card);
  border: none;
  border-radius: 14px;
  border-bottom-left-radius: 4px;
  margin: 4px 0;
  opacity: 1;
}
.thinking-block.done:hover {
  box-shadow: var(--shadow);
}
.thinking-block.done .thinking-header {
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  opacity: 0;
  overflow: hidden;
}
.thinking-block.done .thinking-body {
  border-top: none;
  padding: 10px 16px;
}
.thinking-header {
  padding: 8px 14px;
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
  max-height: 50px;
  transition: all 0.4s ease;
}
.thinking-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.thinking-body {
  padding: 8px 14px 12px;
  border-top: 1px solid var(--border);
  transition: all 0.4s ease;
}
.thinking-content {
  color: var(--text-primary);
}

.sticker-inline {
  display: inline-block;
  vertical-align: middle;
  margin: 4px 6px;
  cursor: pointer;
}

.sticker-img {
  width: 100px;
  height: 100px;
  object-fit: contain;
  transition: transform 0.15s ease;
  display: block;
}

.sticker-inline:hover .sticker-img {
  transform: scale(1.15);
}
</style>
