<template>
  <HtmlSandbox v-if="useSandbox" :html="sandboxHtml" />
  <div v-else ref="bodyRef" class="markdown-body" v-html="renderedHtml" @click="onContainerClick"></div>
  <p v-if="renderError" class="md-render-error">
    <Icon name="warning" :size="14" />
    Markdown 渲染错误: {{ renderError }}
  </p>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { renderMarkdown, renderMarkdownRaw, contentNeedsIsolation } from '@/utils/markdown'
import { safeCopyText } from '@/lib/clipboard'
import HtmlSandbox from './HtmlSandbox.vue'
import { useMediaViewer } from '@/composables/useMediaViewer'
import Icon from '@/components/Icon.vue'
import { createLogger } from '@/utils/logger'

const log = createLogger('RenderMarkdown')

// 按需加载 KaTeX CSS（仅在首次渲染 Markdown 组件时注入）
import('katex/dist/katex.min.css').catch((err) => {
  log.warn('[RenderMarkdown] KaTeX CSS 加载失败，数学公式可能显示异常:', err)
})

const { open } = useMediaViewer()

// ── 代码块复制（CODE-COPY-001） ──
// 消毒器会剥离 button 标签，所以复制按钮在 DOM 层注入（不进 markdown 字符串）；
// 点击用事件委托，流式重渲染后无需重复绑定。
const bodyRef = ref<HTMLElement | null>(null)

function decorateCodeBlocks(root: HTMLElement) {
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('md-code')) return
    if (!pre.querySelector('code')) return
    const wrap = document.createElement('div')
    wrap.className = 'md-code'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'md-code-copy'
    btn.textContent = '复制'
    pre.replaceWith(wrap)
    wrap.append(btn, pre)
  })
}

let copyResetTimer: ReturnType<typeof setTimeout> | null = null

async function onContainerClick(e: MouseEvent) {
  onImageClick(e)
  const btn = (e.target as HTMLElement).closest?.('.md-code-copy') as HTMLElement | null
  if (!btn) return
  const code = btn.closest('.md-code')?.querySelector('pre code')
  if (!code) return
  const ok = await safeCopyText(code.textContent ?? '')
  btn.textContent = ok ? '已复制' : '复制失败'
  btn.classList.toggle('is-done', ok)
  btn.classList.toggle('is-failed', !ok)
  if (copyResetTimer) clearTimeout(copyResetTimer)
  copyResetTimer = setTimeout(() => {
    btn.textContent = '复制'
    btn.classList.remove('is-done', 'is-failed')
  }, 1600)
}

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

const renderResult = computed(() => {
  let error: string | null = null
  let html = ''
  let sandbox = ''

  try {
    // 默认对输出消毒，再交给 v-html，防止 XSS
    html = renderMarkdown(props.content)
  } catch (e) {
    renderErrorCount++
    const msg = e instanceof Error ? e.message : String(e)
    log.error(`[RenderMarkdown] marked.parse 错误 (第 ${renderErrorCount} 次):`, msg)
    log.error('  内容预览:', props.content.slice(0, 200))
    error = msg
  }

  // ANIM-MD-001：流式期间 useSandbox 恒为 false（iframe 会因内容频繁变化
  // 不断重载）——raw 渲染此时必然不会被消费，跳过可省去每 80ms 一次的
  // 全量 md.parse + sanitizeHtml（长流式下 O(n²) 的纯浪费）。
  if (!props.streaming) {
    try {
      sandbox = renderMarkdownRaw(props.content)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('[RenderMarkdown] raw render 错误:', msg)
      if (!error) error = msg
    }
  }

  return { html, sandbox, error }
})

const renderedHtml = computed(() => renderResult.value.html)
const renderError = computed(() => renderResult.value.error)

// 每次渲染后给代码块挂复制按钮（v-html 会重建 DOM，需在渲染后补）
watch(renderedHtml, async () => {
  await nextTick()
  if (bodyRef.value) decorateCodeBlocks(bodyRef.value)
}, { immediate: true, flush: 'post' })

/** 供 iframe 沙箱使用的未消毒 HTML，保留脚本/样式等交互能力。 */
const sandboxHtml = computed(() => renderResult.value.sandbox)

const useSandbox = computed(() => {
  if (props.streaming) return false
  if (!props.content) return false
  if (props.forceSandbox) return true
  try {
    return contentNeedsIsolation(props.content)
  } catch (e) {
    log.error('[RenderMarkdown] contentNeedsIsolation 检测异常:', e)
    return true // 无法确定时启用沙箱（安全降级）
  }
})
</script>

<style>
/* CSP-safe: class-based styling for v-html error fallback (was inline style) */
.md-render-error {
  color: var(--status-error-text);
}
</style>
