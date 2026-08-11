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
        <!-- 流式答案（becameAnswer）：纯文本增量逐词 reveal（ANIM-SPLIT-001），实现打字机生长感；
             复杂 markdown（代码/表格）降级走 RenderMarkdown 保证格式正确 -->
        <div
          v-if="isStreamingAnswer"
          ref="answerStreamEl"
          class="answer-stream"
          aria-label="Maxma 正在输入"
        ></div>
        <template v-else-if="block.becameAnswer">
          <template v-for="(seg, i) in segments" :key="i">
            <!-- :streaming 使 RenderMarkdown 在流式阶段跳过沙箱 iframe 逐 token 重建（RENDER-O2 修复） -->
            <RenderMarkdown v-if="seg.type === 'text'" :content="seg.text" :streaming="!block.done" />
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
import { gsap, useGsap, easeMap } from '@/composables/useGsap'

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

// 增量逐词 reveal（ANIM-SPLIT-001）：token 追加时只对新增文本创建 word spans。
// 此前用 SplitText 每帧全量重拆（split() 内部先 revert 全部 span 再全量重建，
// 长回答 O(n²) DOM 增删 + 每帧整块 reflow）。改为手动增量：按空白切分新增
// 片段，逐词包 <span class="answer-word"> 追加到容器，仅动画新词。
let lastProcessedLen = 0
let streamRaf = 0

// 每次增量处理的字符上限（防单帧 token 爆发一次创建过多节点）
const MAX_CHARS_PER_FRAME = 2000

useGsap((_ctx, contextSafe) => {
  const doSplit = contextSafe(() => {
    const el = answerStreamEl.value
    const text = props.block.tokens ?? ''
    if (!el || !props.block.becameAnswer || props.block.done) return
    if (!isPlainAnswer(text)) {
      // 复杂 markdown（代码/表格）：清空增量容器，交给 RenderMarkdown 渲染
      el.textContent = ''
      lastProcessedLen = 0
      return
    }
    const clean = stripThinkingLabels(text.replace(STICKER_PLACEHOLDER_RE, ''))
    if (clean.length < lastProcessedLen) {
      // 内容回退（如替换指令）：整体重建
      el.textContent = clean
      lastProcessedLen = clean.length
      return
    }
    if (clean.length === lastProcessedLen) return

    // 增量追加：只处理新增片段（含标点/空白的词边界切分）
    const delta = clean.slice(lastProcessedLen, lastProcessedLen + MAX_CHARS_PER_FRAME)
    lastProcessedLen += delta.length

    const frag = document.createDocumentFragment()
    const freshWords: HTMLElement[] = []
    // 按词切分（保留空白为独立 span，保证词间距与换行）
    const parts = delta.split(/(\s+)/)
    for (const part of parts) {
      if (!part) continue
      const span = document.createElement('span')
      span.className = 'answer-word'
      span.textContent = part
      frag.appendChild(span)
      if (part.trim()) freshWords.push(span)
    }
    el.appendChild(frag)

    if (freshWords.length) {
      gsap.from(freshWords, {
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
        doSplit()
      })
    },
    { immediate: true },
  )

  // 卸载时取消 pending rAF，避免组件销毁后仍执行 doSplit
  _ctx.add(() => {
    if (streamRaf) {
      cancelAnimationFrame(streamRaf)
      streamRaf = 0
    }
  })

  // 答案完成：清空增量容器状态（容器本身随 isStreamingAnswer=false 隐藏，
  // 完整 markdown 由 segments/RenderMarkdown 渲染）
  watch(
    () => props.block.done,
    contextSafe((done) => {
      if (done) {
        const el = answerStreamEl.value
        if (el) el.textContent = ''
        lastProcessedLen = 0
      }
    }),
  )
})

/** 解析内容中的 <sticker:category/filename.webp> 标记，分段返回。
 *  RENDER-O2 修复：流式阶段用 80ms 节流的 displayText（与思考阶段同一节流器）
 *  切分，避免每个 token 触发全量 md.render + sanitizeHtml 的 O(n²) 渲染；
 *  done 时 displayText 已被 watch 立即设为全量，内容不丢。 */
const cleanedTokens = computed(() =>
  props.block.done ? stripThinkingLabels(props.block.tokens ?? '') : displayText.value,
)
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
