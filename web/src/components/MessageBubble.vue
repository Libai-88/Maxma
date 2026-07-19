<template>
  <div class="message-row" :class="role">
    <div class="bubble" :class="role">
      <div
        class="bubble-content"
        :class="{ collapsed: isCollapsible && isCollapsed }"
        ref="contentEl"
      >
        <template v-for="(seg, i) in segments" :key="i">
          <RenderMarkdown v-if="seg.type === 'text'" :content="seg.text" />
          <StickerInline v-else :sticker="seg" @preview="previewSticker" />
        </template>
        <StickerInline
          v-if="attachedSticker"
          :sticker="attachedSticker"
          @preview="previewSticker"
        />
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
      <div v-if="readStatus" class="read-status" :class="readStatus">
        <span class="read-dot"></span>
        <span>{{ readStatus === 'read' ? '已读' : '送达' }}</span>
      </div>
    </div>
    <!-- 表情预览 overlay -->
    <StickerPreviewOverlay
      v-if="previewIndex >= 0"
      :stickers="stickerSegments"
      :initial-index="previewIndex"
      @close="previewIndex = -1"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import type { ParsedRef } from '@/utils/references'
import ReferenceChip from './ReferenceChip.vue'
import RenderMarkdown from './RenderMarkdown.vue'
import StickerInline from './StickerInline.vue'
import StickerPreviewOverlay from './StickerPreviewOverlay.vue'
import { useStickerSegments, type StickerSegment } from '@/composables/useStickerSegments'
import { stripStickerDirectives } from '@/composables/stickerUtils'

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
  refs?: ParsedRef[]
  readStatus?: 'pending' | 'read'
  stickerUrl?: string
}>()

const isCollapsed = ref(true)
const contentEl = ref<HTMLElement | null>(null)
const contentHeight = ref(0)
const previewIndex = ref(-1)

const isCollapsible = computed(() => contentHeight.value > 500)

/** 解析内容中的 <sticker:category/filename.webp> 标记，分段返回 */
const displayContent = computed(() =>
  props.stickerUrl ? stripStickerDirectives(props.content) : props.content,
)
const segments = useStickerSegments(displayContent)
const attachedSticker = computed<StickerSegment | null>(() => {
  if (!props.stickerUrl) return null
  return {
    type: 'sticker',
    src: props.stickerUrl,
    path: props.stickerUrl,
    category: '表情',
    filename: '情绪表情包',
    occurrenceKey: 'attached-' + props.stickerUrl,
    start: 0,
    end: 0,
  }
})
const stickerSegments = computed(() => {
  const inline = segments.value.filter((seg): seg is StickerSegment => seg.type === 'sticker')
  return attachedSticker.value ? [...inline, attachedSticker.value] : inline
})

function previewSticker(sticker: StickerSegment) {
  previewIndex.value = stickerSegments.value.findIndex(
    seg => seg.occurrenceKey === sticker.occurrenceKey
  )
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
  max-width: min(100%, 760px);
  padding: 10px 16px;
  border-radius: 14px;
  font-size: 1em;
  line-height: 1.6;
  word-break: break-word;
  overflow-wrap: anywhere;
  box-shadow: var(--shadow);
}
.bubble.user {
	  background: var(--user-bubble);
	  color: var(--text-primary);
	  border: 1px solid var(--border);
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
  border-top: 1px solid transparent;
  border-top: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
}

.read-status {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 4px;
  font-size: 0.72em;
  line-height: 1;
  color: var(--text-tertiary);
}

.read-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
  transition: background 0.2s, box-shadow 0.2s;
}

.read-status.read .read-dot {
	  background: var(--status-info);
	  box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-info) 12%, transparent);
	}

@media (prefers-reduced-motion: reduce) {
  .message-row {
    animation: none;
  }

  .bubble-content,
  .collapse-toggle,
  .read-dot {
    transition: none;
  }
}

</style>
