<template>
  <HtmlSandbox v-if="useSandbox" :html="sandboxHtml" />
  <div v-else class="markdown-body" v-html="renderedHtml" @click="onImageClick"></div>
  <p v-if="renderError" class="md-render-error">
    <Icon name="warning" :size="14" />
    Markdown 渲染错误: {{ renderError }}
  </p>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { renderMarkdown, renderMarkdownRaw, contentNeedsIsolation } from '@/utils/markdown'
import HtmlSandbox from './HtmlSandbox.vue'
import { useMediaViewer } from '@/composables/useMediaViewer'
import Icon from '@/components/Icon.vue'

// 按需加载 KaTeX CSS（仅在首次渲染 Markdown 组件时注入）
import('katex/dist/katex.min.css').catch((err) => {
  console.warn('[RenderMarkdown] KaTeX CSS 加载失败，数学公式可能显示异常:', err)
})

const { open } = useMediaViewer()

function onImageClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'IMG') {
    e.preventDefault()
    const img = target as HTMLImageElement
    // 收集同一容器内所有图片，支持画廊切换
    const container = img.closest('.markdown-body')
    const allImgs = container ? Array.from(container.querySelectorAll('img')) : [img]
    const items = allImgs.map(im => ({ src: (im as HTMLImageElement).src, alt: (im as HTMLImageElement).alt }))
    const startIndex = allImgs.indexOf(img)
    open(items, startIndex)
  }
}

const props = withDefaults(defineProps<{
  /** 原始 Markdown 文本 */
  content: string
  /** 强制使用 sandbox 渲染（即使检测不到 script 标签） */
  forceSandbox?: boolean
  /** 处于流式接收中时禁用沙箱，避免 iframe 因内容频繁变化而不断重载 */
  streaming?: boolean
}>(), {
  forceSandbox: false,
  streaming: false,
})

let renderErrorCount = 0
const renderError = ref<string | null>(null)

const renderedHtml = computed(() => {
  try {
    renderError.value = null
    // 默认对输出消毒，再交给 v-html，防止 XSS
    const result = renderMarkdown(props.content)
    return result
  } catch (e) {
    renderErrorCount++
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[RenderMarkdown] marked.parse 错误 (第 ${renderErrorCount} 次):`, msg)
    console.error('  内容预览:', props.content.slice(0, 200))
    renderError.value = msg
    return ''
  }
})

/** 供 iframe 沙箱使用的未消毒 HTML，保留脚本/样式等交互能力。 */
const sandboxHtml = computed(() => {
  try {
    renderError.value = null
    return renderMarkdownRaw(props.content)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[RenderMarkdown] raw render 错误:', msg)
    renderError.value = msg
    return ''
  }
})

const useSandbox = computed(() => {
  if (props.streaming) return false
  if (!props.content) return false
  if (props.forceSandbox) return true
  try {
    return contentNeedsIsolation(props.content)
  } catch (e) {
    console.error('[RenderMarkdown] contentNeedsIsolation 检测异常:', e)
    return true // 无法确定时启用沙箱（安全降级）
  }
})
</script>

<style>
/* CSP-safe: class-based styling for v-html error fallback (was inline style) */
.md-render-error {
  color: var(--status-error);
}
</style>
