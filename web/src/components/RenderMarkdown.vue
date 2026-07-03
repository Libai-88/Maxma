<template>
  <HtmlSandbox v-if="useSandbox" :html="sandboxHtml" />
  <div v-else class="markdown-body" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { computed, onUnmounted } from 'vue'
import { renderMarkdown, renderMarkdownRaw, contentNeedsIsolation } from '@/utils/markdown'
import HtmlSandbox from './HtmlSandbox.vue'

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

const renderedHtml = computed(() => {
  try {
    // 默认对输出消毒，再交给 v-html，防止 XSS
    const result = renderMarkdown(props.content)
    return result
  } catch (e) {
    renderErrorCount++
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[RenderMarkdown] marked.parse 错误 (第 ${renderErrorCount} 次):`, msg)
    console.error('  内容预览:', props.content.slice(0, 200))
    return `<p style="color:var(--status-error)">⚠ Markdown 渲染错误: ${msg}</p>`
  }
})

/** 供 iframe 沙箱使用的未消毒 HTML，保留脚本/样式等交互能力。 */
const sandboxHtml = computed(() => {
  try {
    return renderMarkdownRaw(props.content)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[RenderMarkdown] raw render 错误:', msg)
    return `<p style="color:var(--status-error)">⚠ Markdown 渲染错误: ${msg}</p>`
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
    return false // 降级：不启用沙箱
  }
})
</script>
