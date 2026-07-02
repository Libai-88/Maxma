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
            <StickerInline v-else :sticker="seg" @preview="previewSticker" />
          </template>
        </template>
        <RenderMarkdown v-else :content="streamingText" :streaming="!block.done" />
      </div>
    </div>
  </div>
  <!-- 表情预览 overlay -->
  <StickerPreviewOverlay
    v-if="previewIndex >= 0"
    :stickers="stickerSegments"
    :initial-index="previewIndex"
    @close="previewIndex = -1"
  />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ThinkingBlock as ThinkingBlockType } from '@/types'
import RenderMarkdown from './RenderMarkdown.vue'
import StickerInline from './StickerInline.vue'
import StickerPreviewOverlay from './StickerPreviewOverlay.vue'
import { useStickerSegments, type StickerSegment } from '@/composables/useStickerSegments'

const props = defineProps<{ block: ThinkingBlockType }>()

const previewIndex = ref(-1)

function previewSticker(sticker: StickerSegment) {
  previewIndex.value = stickerSegments.value.findIndex(
    seg => seg.occurrenceKey === sticker.occurrenceKey
  )
}

const STICKER_PLACEHOLDER_RE = /\[表情包(?::[^\]]+)?\]/g

/** 流式阶段隐藏原始 [表情包:xxx] 占位符，避免用户看到明文 */
const streamingText = computed(() => {
  const text = props.block.tokens
  if (!text) return ''
  return text.replace(STICKER_PLACEHOLDER_RE, '')
})

/** 解析内容中的 <sticker:category/filename.webp> 标记，分段返回 */
const segments = useStickerSegments(computed(() => props.block.tokens))
const stickerSegments = computed(() => segments.value.filter((seg): seg is StickerSegment => seg.type === 'sticker'))
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

@media (prefers-reduced-motion: reduce) {
  .thinking-block,
  .thinking-header,
  .thinking-body {
    transition: none;
  }

  .spinner {
    animation: none;
  }
}

</style>
