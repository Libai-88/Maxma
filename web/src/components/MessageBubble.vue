<template>
  <article class="message-row" :class="role" :aria-label="role === 'user' ? '我的消息' : 'Maxma 回复'">
    <div class="bubble" :class="role" role="group">
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
        type="button"
        :aria-expanded="!isCollapsed"
        aria-label="切换消息展开状态"
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
  </article>
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
  min-width: 0;
}
.message-row + .message-row {
  margin-top: 2px;
}
.message-row.user {
  justify-content: flex-end;
  --row-slide-x: 12px;
}
.message-row.assistant {
  justify-content: flex-start;
  --row-slide-x: -12px;
}
.message-row {
  opacity: 1;
  transform: translateX(0);
  transition: opacity 0.15s var(--ease-out),
              transform 0.15s var(--ease-out);
  @starting-style {
    opacity: 0;
    transform: translateX(var(--row-slide-x, 12px));
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
  min-width: 0;
  transition: transform 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              box-shadow 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
.bubble.user {
    background: linear-gradient(
      145deg,
      color-mix(in srgb, var(--user-bubble-solid) 92%, var(--bg-card)) 0%,
      var(--user-bubble-solid) 100%
    );
    color: var(--user-bubble-text);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
      0 2px 12px color-mix(in srgb, var(--user-bubble-solid) 18%, transparent),
      0 1px 3px color-mix(in srgb, var(--user-bubble-solid) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--user-bubble-solid) 20%, transparent);
    border-bottom-right-radius: var(--radius-sm);
  }
.bubble.assistant {
  background: color-mix(in srgb, var(--bg-card) 85%, var(--accent) 2%);
  color: var(--text-primary);
  border: 1px solid color-mix(in srgb, var(--accent) 6%, var(--border));
  border-bottom-left-radius: var(--radius-sm);
  box-shadow:
    0 1px 4px var(--shadow-color),
    inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 60%, transparent);
}

@media (pointer: fine) {
  .bubble:hover {
    transform: translateY(-1px);
  }
  .bubble.user:hover {
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
      0 4px 16px color-mix(in srgb, var(--user-bubble-solid) 20%, transparent),
      0 2px 6px color-mix(in srgb, var(--user-bubble-solid) 10%, transparent);
  }
  .bubble.assistant:hover {
    box-shadow:
      0 4px 16px var(--shadow-color),
      inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 60%, transparent);
  }
}

/* ── 大输出折叠 ── */
.bubble-content {
  overflow: hidden;
  transition: max-height 0.25s var(--ease-out);
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
  background: linear-gradient(transparent, var(--user-bubble-solid));
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
  transition: color 0.2s var(--ease-out),
              border-color 0.2s var(--ease-out);
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
    animation: readPulse 2s ease-out 1;
  }
@keyframes readPulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-info) 30%, transparent); }
  100% { box-shadow: 0 0 0 6px transparent; }
}

/* ── 用户气泡内文字修正 ── */
/* markdown.css 全局设置 .markdown-body { color: var(--text-primary) }，
   会覆盖 .bubble.user 的 color: var(--user-bubble-text)，
   导致深色背景主题下文字对比度不足。 */
.bubble.user :deep(.markdown-body) {
  color: var(--user-bubble-text);
}
.bubble.user :deep(.markdown-body h6) {
  color: color-mix(in srgb, var(--user-bubble-text) 65%, transparent);
}

/* 已读/送达状态在用户气泡内应使用 --user-bubble-text 派生色，确保可见 */
.bubble.user .read-status {
  color: color-mix(in srgb, var(--user-bubble-text) 58%, transparent);
}
.bubble.user .read-status .read-dot {
  background: color-mix(in srgb, var(--user-bubble-text) 58%, transparent);
}
.bubble.user .read-status.read .read-dot {
  background: var(--status-info);
}

@media (prefers-reduced-motion: reduce) {
  .message-row {
    animation: none;
  }

  .message-row {
    transition: none;
    opacity: 1;
    transform: none;
  }

  .bubble {
    transition: none;
  }

  .bubble-content,
  .collapse-toggle,
  .read-dot {
    transition: none;
  }

  .read-dot {
    animation: none;
  }
}

</style>
