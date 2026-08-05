<template>
  <div ref="rootEl" class="thinking-block" :class="{ done: block.done }">
    <div class="thinking-header">
      <span class="thinking-label">
        <span class="spinner" v-if="!block.done"></span>
        思考中{{ block.done ? '（完成）' : '……' }}
      </span>
    </div>
    <div class="thinking-body" v-if="block.tokens">
      <div class="thinking-content">
        <!-- 流式答案（becameAnswer）：纯文本用 SplitText 增量逐词 reveal，实现打字机生长感；
             复杂 markdown（代码/表格）降级走 RenderMarkdown 保证格式正确 -->
        <div
          v-if="isStreamingAnswer"
          ref="answerStreamEl"
          class="answer-stream"
          aria-label="Maxma 正在输入"
        ></div>
        <template v-else-if="block.becameAnswer">
          <template v-for="(seg, i) in segments" :key="i">
            <RenderMarkdown v-if="seg.type === 'text'" :content="seg.text" />
            <StickerInline v-else :sticker="seg" @preview="previewSticker" />
          </template>
        </template>
        <RenderMarkdown v-else :content="displayText" :streaming="!block.done" />
        <span v-if="!block.done && !block.becameAnswer" class="stream-caret" aria-hidden="true"></span>
        <span v-if="isStreamingAnswer" class="stream-caret" aria-hidden="true"></span>
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
import { ref, computed, watch, onUnmounted } from 'vue'
import type { ThinkingBlock as ThinkingBlockType } from '@/types'
import RenderMarkdown from './RenderMarkdown.vue'
import StickerInline from './StickerInline.vue'
import StickerPreviewOverlay from './StickerPreviewOverlay.vue'
import { useStickerSegments, type StickerSegment } from '@/composables/useStickerSegments'
import { hasEmotionTag } from '@/composables/stickerUtils'
import { gsap, useGsap, easeMap, lazyLoadPlugin } from '@/composables/useGsap'

const props = defineProps<{ block: ThinkingBlockType }>()

const previewIndex = ref(-1)
const answerStreamEl = ref<HTMLElement | null>(null)

function previewSticker(sticker: StickerSegment) {
  previewIndex.value = stickerSegments.value.findIndex(
    seg => seg.occurrenceKey === sticker.occurrenceKey
  )
}

const STICKER_PLACEHOLDER_RE = /\[表情包(?::[^\]]+)?\]/g

/** 模型思考开头可能出现的角色扮演元标签，对用户无意义，直接剥离 */
const THINKING_LABELS_RE = /^\s*(?:Vibe|Sparks|Reflections|Will)\s*:.*$/gm

function stripThinkingLabels(text: string): string {
  return text.replace(THINKING_LABELS_RE, '')
}

/** 流式阶段隐藏原始 [表情包:xxx] 占位符，避免用户看到明文 */
const streamingText = computed(() => {
  const text = props.block.tokens
  if (!text) return ''
  return stripThinkingLabels(text.replace(STICKER_PLACEHOLDER_RE, ''))
})

// 流式 markdown 节流：思考阶段每 token 更新 streamingText 会触发 RenderMarkdown
// 全量 md.render + sanitizeHtml，累加全文为 O(n²)，长推理会卡死主线程。
// 这里最多每 80ms 刷新一次显示文本；done 时立即全量渲染，保证内容不丢。
const displayText = ref('')
let mdThrottleTimer = 0
watch(streamingText, (val) => {
  if (props.block.done) {
    displayText.value = val
    return
  }
  if (mdThrottleTimer) return
  mdThrottleTimer = window.setTimeout(() => {
    mdThrottleTimer = 0
    displayText.value = streamingText.value
  }, 80)
}, { immediate: true })
watch(() => props.block.done, (done) => {
  if (done) {
    if (mdThrottleTimer) {
      window.clearTimeout(mdThrottleTimer)
      mdThrottleTimer = 0
    }
    displayText.value = streamingText.value
  }
})
onUnmounted(() => {
  if (mdThrottleTimer) {
    window.clearTimeout(mdThrottleTimer)
    mdThrottleTimer = 0
  }
})

/** 纯文本答案判断：含代码围栏/表格行/标题/表情标记（含裸情感词）则降级走 RenderMarkdown/segments，
 * 避免 SplitText 拆坏结构或吞掉表情（表情走 StickerInline 渲染） */
const isPlainAnswer = (text: string): boolean =>
  !!text &&
  !/```/.test(text) &&
  !/^\s*\|/m.test(text) &&
  !/^\s*#/m.test(text) &&
  !/<sticker:|\[表情(?:包)?[:：]/.test(text) &&
  !hasEmotionTag(text)

const isStreamingAnswer = computed(() =>
  props.block.becameAnswer && !props.block.done && isPlainAnswer(props.block.tokens ?? '')
)

// 增量逐词 reveal：token 追加时只对新词做 from，实现打字机生长感
// SplitText 实例复用，split() 重拆后仅动画 lastWordCount 之后的新词
// rAF 节流：同帧内多次 token 更新合并为一次重拆，避免高频抖动
let answerSplit: SplitText | null = null
let lastWordCount = 0
let streamRaf = 0

useGsap((ctx, contextSafe) => {
  const doSplit = contextSafe(async () => {
    const el = answerStreamEl.value
    const text = props.block.tokens ?? ''
    if (!el || !props.block.becameAnswer || props.block.done) return
    if (!isPlainAnswer(text)) {
      answerSplit?.revert()
      answerSplit = null
      lastWordCount = 0
      return
    }
    el.textContent = stripThinkingLabels(text.replace(STICKER_PLACEHOLDER_RE, ''))
    let SplitText: any
    try {
      SplitText = await lazyLoadPlugin('SplitText')
      if (!SplitText || !SplitText.create) throw new Error('SplitText 插件不可用')
    } catch {
      // 插件按需加载失败时跳过字符级动画，不阻塞答案渲染
      answerSplit = null
      lastWordCount = 0
      return
    }
    if (answerSplit) {
      answerSplit.split({ type: 'words', wordsClass: 'answer-word' })
    } else {
      answerSplit = SplitText.create(el, { type: 'words', wordsClass: 'answer-word', aria: 'auto' })
      lastWordCount = 0
    }
    const words = answerSplit?.words ?? []
    const fresh = words.slice(lastWordCount)
    lastWordCount = words.length
    if (fresh.length) {
      gsap.from(fresh, {
        yPercent: 26,
        autoAlpha: 0,
        duration: 0.3,
        ease: easeMap.out,
        stagger: 0.015,
        overwrite: 'auto',
      })
    }
  })

  watch(
    () => props.block.tokens,
    () => {
      if (streamRaf) return
      streamRaf = requestAnimationFrame(() => {
        streamRaf = 0
        void doSplit()
      })
    },
    { immediate: true },
  )

  // 卸载时取消 pending rAF，避免组件销毁后仍执行 doSplit
  ctx.add(() => {
    if (streamRaf) {
      cancelAnimationFrame(streamRaf)
      streamRaf = 0
    }
  })

  // 答案完成：revert SplitText，切回 RenderMarkdown 完整渲染（含 markdown/sticker）
  watch(
    () => props.block.done,
    contextSafe((done) => {
      if (done && answerSplit) {
        answerSplit.revert()
        answerSplit = null
        lastWordCount = 0
      }
    }),
  )
})

/** 解析内容中的 <sticker:category/filename.webp> 标记，分段返回 */
const cleanedTokens = computed(() => stripThinkingLabels(props.block.tokens ?? ''))
const segments = useStickerSegments(cleanedTokens)
const stickerSegments = computed(() => segments.value.filter((seg): seg is StickerSegment => seg.type === 'sticker'))

// 入场：思考块出现时轻淡入上浮（done 折叠仍由 CSS transition 处理）
const rootEl = ref<HTMLElement | null>(null)
useGsap(() => {
  const el = rootEl.value
  if (!el) return
  gsap.fromTo(el, { opacity: 0, y: -4 }, { opacity: 1, y: 0, duration: 0.2, ease: easeMap.out })
})
</script>

<style scoped>
.thinking-block {
  margin: 8px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  overflow: hidden;
  transition: background 0.25s var(--ease-out),
              border 0.25s var(--ease-out),
              border-radius 0.25s var(--ease-out);
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
  transition: opacity 0.25s var(--ease-out),
              max-height 0.25s var(--ease-out),
              padding 0.25s var(--ease-out);
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
  animation: maxma-spin 0.8s linear infinite;
}
.thinking-body {
  padding: 8px 14px 12px;
  border-top: 1px solid var(--border);
  transition: border-top 0.25s var(--ease-out),
              padding 0.25s var(--ease-out);
}
.thinking-content {
  color: var(--text-primary);
}
.answer-stream {
  display: inline;
}
.answer-stream :deep(.answer-word) {
  display: inline-block;
  white-space: pre-wrap;
}

/* 流式打字光标：内容尾部闪烁竖线 */
.stream-caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  border-radius: 1px;
  background: var(--accent);
  animation: maxma-caret-blink 0.9s steps(2, start) infinite;
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
