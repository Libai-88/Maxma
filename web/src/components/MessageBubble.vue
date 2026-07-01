<template>
  <div class="message-row" :class="role">
    <div class="bubble" :class="role">
      <div
        class="bubble-content"
        :class="{ collapsed: isCollapsed }"
        ref="contentEl"
      >
        <template v-for="(seg, i) in segments" :key="i">
          <RenderMarkdown v-if="seg.type === 'text'" :content="seg.text" />
          <span v-else class="sticker-inline" @click="previewSticker(seg.src)">
            <img :src="seg.src" class="sticker-img" loading="lazy" />
          </span>
        </template>
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
    <!-- 表情预览 overlay -->
    <div v-if="previewSrc" class="sticker-preview-overlay" @click="previewSrc = ''">
      <img :src="previewSrc" class="sticker-preview-img" />
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
const previewSrc = ref('')

const isCollapsible = computed(() => contentHeight.value > 500)

/** 解析内容中的 <sticker:category/filename.webp> 标记，分段返回 */
const segments = computed(() => {
  const text = props.content
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

function previewSticker(src: string) {
  previewSrc.value = src
}

function measureHeight() {
  if (contentEl.value) {
    contentHeight.value = contentEl.value.scrollHeight
  }
}

onMounted(() => {
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
  animation: messageSlideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.message-row.user {
  justify-content: flex-end;
}
.message-row.assistant {
  justify-content: flex-start;
}

@keyframes messageSlideIn {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.bubble {
  max-width: 72%;
  padding: 10px 16px;
  border-radius: 14px;
  font-size: 1em;
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
  font-size: 0.8em;
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

/* ── 表情包内联渲染 ── */
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

/* ── 表情预览 overlay ── */
.sticker-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  cursor: pointer;
  animation: fadeIn 0.15s ease;
}

.sticker-preview-img {
  max-width: 80vw;
  max-height: 80vh;
  object-fit: contain;
  animation: scaleIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scaleIn {
  from { transform: scale(0.8); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
</style>
