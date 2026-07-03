import MarkdownIt from 'markdown-it'
import texmath from 'markdown-it-texmath'
import taskLists from 'markdown-it-task-lists'
import katex from 'katex'

const md = new MarkdownIt({
  html: true,    // 透传原始 HTML（LLM 直接输出交互式 HTML 的关键功能）
  breaks: true,  // \n → <br>，适配聊天场景的换行
  linkify: true, // 自动识别 URL 为可点击链接
})

// ── XSS 防御：无外部依赖的轻量级 HTML 消毒 ─────────────────
// 因运行环境限制无法新增 npm 包，使用浏览器原生 DOMParser 实现。

/** 危险标签：这些标签会执行代码或引入外部资源。 */
const DANGEROUS_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'object', 'embed', 'applet',
  'meta', 'link', 'base', 'form', 'input', 'textarea', 'select', 'option',
  'noscript', 'template',
])

/** 允许保留但需清理属性的标签。 */
const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'q', 'cite',
  'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'img', 'figure', 'figcaption',
  'details', 'summary',
  'mark', 'small', 'sub', 'sup', 'time',
  'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
])

/** URL 属性：需要校验协议，防止 javascript: 伪协议。 */
const URL_ATTRS = new Set([
  'href', 'src', 'srcset', 'action', 'formaction', 'cite', 'poster', 'data',
])

const ALLOWED_URL_SCHEMES = new Set([
  'http:', 'https:', 'mailto:', 'tel:', 'data:', 'ftp:', 'ftps:',
])

function isDangerousUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  // 拦截 javascript:、vbscript:、data:text/html 等危险协议
  if (/^(javascript|vbscript|data:text\/html|data:image\/svg\+xml)/i.test(trimmed)) {
    return true
  }
  // 显式协议但不在白名单内
  const match = trimmed.match(/^([a-z][a-z0-9+.-]*:)/i)
  if (match && !ALLOWED_URL_SCHEMES.has(match[1].toLowerCase())) {
    return true
  }
  return false
}

function sanitizeAttribute(name: string, value: string): string | null {
  const lowerName = name.toLowerCase()

  // 1. 事件处理器全部移除
  if (lowerName.startsWith('on')) {
    return null
  }

  // 2. 危险属性直接移除
  if (
    lowerName === 'style' ||
    lowerName === 'contenteditable' ||
    lowerName === 'draggable' ||
    lowerName === 'form' ||
    lowerName === 'formaction' ||
    lowerName === 'manifest'
  ) {
    return null
  }

  // 3. URL 属性校验协议
  if (URL_ATTRS.has(lowerName) && isDangerousUrl(value)) {
    return null
  }

  return value
}

function sanitizeNode(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.cloneNode(false)
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    return null // 移除注释，防止条件注释等技巧
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null
  }

  const el = node as Element
  const tag = el.tagName.toLowerCase()

  // 移除危险标签（包括子树）
  if (DANGEROUS_TAGS.has(tag)) {
    return null
  }

  // 不在白名单的标签：只保留子节点内容（unwrap）
  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = document.createDocumentFragment()
    el.childNodes.forEach((child) => {
      const sanitized = sanitizeNode(child)
      if (sanitized) fragment.appendChild(sanitized)
    })
    return fragment
  }

  // 创建同类型元素（避免克隆可能存在的污染）
  const safe = document.createElement(tag)
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]
    if (!attr) continue
    const cleanValue = sanitizeAttribute(attr.name, attr.value)
    if (cleanValue !== null) {
      safe.setAttribute(attr.name, cleanValue)
    }
  }

  el.childNodes.forEach((child) => {
    const sanitized = sanitizeNode(child)
    if (sanitized) safe.appendChild(sanitized)
  })

  return safe
}

/** 对 HTML 字符串进行消毒，移除危险标签、事件处理器与伪协议 URL。 */
export function sanitizeHtml(input: string): string {
  if (!input) return ''
  const parser = new DOMParser()
  const doc = parser.parseFromString(input, 'text/html')
  const fragment = document.createDocumentFragment()

  Array.from(doc.body.childNodes).forEach((child) => {
    const sanitized = sanitizeNode(child)
    if (sanitized) fragment.appendChild(sanitized)
  })

  const wrapper = document.createElement('div')
  wrapper.appendChild(fragment)
  return wrapper.innerHTML
}

// GFM 任务列表：- [x] 已完成 / - [ ] 未完成
md.use(taskLists, { enabled: true })

// 数学公式支持：$...$ / $$...$$ / \(...\) / \[...\]
md.use(texmath, {
  engine: katex,
  delimiters: [
    'dollars',     // $...$ 和 $$...$$
    'parentheses', // \(...\)
    'brackets',    // \[...\]
  ],
  allow_escape: true,    // \$ 转义为字面 $ 符号
  katexOptions: {
    throwOnError: false, // 公式渲染失败时降级显示原文，不抛异常
  },
})

// 自定义 fence 渲染器：```html 代码块渲染为实际 HTML，而非源代码显示
// 内容先经过 sanitizeHtml，避免 LLM 通过 html 代码块注入脚本。
const defaultFence = md.renderer.rules.fence

md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx]
  const info = token.info ? token.info.trim() : ''
  const lang = info.split(/\s+/)[0].toLowerCase()

  // ```html 代码块：输出原始内容作为实际 HTML（不包裹 <pre><code>）
  if (lang === 'html') {
    return sanitizeHtml(token.content)
  }

  // 其他语言：使用默认渲染（转义后包裹 <pre><code>）
  if (defaultFence) {
    return defaultFence(tokens, idx, options, env, self)
  }
  return self.renderToken(tokens, idx, options)
}

// ── 渲染缓存 ──────────────────────────────────────────────
// Map 保持插入顺序，满时删除最早插入的条目（FIFO 淘汰）
const RENDER_CACHE_MAX = 200
const renderCache = new Map<string, string>()
const rawRenderCache = new Map<string, string>()

function getCachedRender(input: string, sanitize = true): string {
  const cache = sanitize ? renderCache : rawRenderCache
  // 命中：删除再插入以刷新为"最新"（近似 LRU）
  if (cache.has(input)) {
    const cached = cache.get(input)!
    cache.delete(input)
    cache.set(input, cached)
    return cached
  }
  // 未命中：渲染并缓存
  const html = md.render(input)
  const output = sanitize ? sanitizeHtml(html) : html
  if (cache.size >= RENDER_CACHE_MAX) {
    // 删除最早插入的条目
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) {
      cache.delete(firstKey)
    }
  }
  cache.set(input, output)
  return output
}

export interface RenderMarkdownOptions {
  /** 是否对输出进行消毒（默认 true）。沙箱渲染可传 false 以保留原始交互式 HTML。 */
  sanitize?: boolean
}

export function renderMarkdown(content: string, options: RenderMarkdownOptions = {}): string {
  if (!content) return ''
  return getCachedRender(content, options.sanitize !== false)
}

/** 渲染 Markdown 但不进行消毒，用于 iframe 沙箱等隔离环境。 */
export function renderMarkdownRaw(content: string): string {
  if (!content) return ''
  return getCachedRender(content, false)
}

/** 清空渲染缓存（供调试或主题切换时使用）。 */
export function clearRenderCache(): void {
  renderCache.clear()
  rawRenderCache.clear()
}

/**
 * 检测 Markdown 原文是否包含需要沙箱隔离的原始 HTML/JS/CSS。
 * 跳过非 HTML 围栏代码块内的内容；HTML 代码块（```html）内的内容仍接受沙箱检测。
 *
 * 触发隔离的条件：
 * - `<script>` — JS 脚本（v-html 不执行，iframe 才执行）
 * - `<style>` / `<link rel="stylesheet">` — 全局 CSS（泄漏到气泡外部）
 * - `onXxx="..."` — 内联事件处理器
 * - `href="javascript:..."` — 伪协议 URL
 * - `<iframe>` — 嵌入式框架
 */
export function contentNeedsIsolation(markdown: string): boolean {
  if (!markdown) return false
  let inCodeBlock = false
  let codeBlockLang = ''
  const lines = markdown.split('\n')
  for (const line of lines) {
    const trimmed = line.trimStart()
    // 切换围栏代码块状态，同时记录语言标签
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        // 进入代码块：提取语言标签（``` 后的第一个词）
        codeBlockLang = trimmed.slice(3).trim().split(/\s+/)[0].toLowerCase()
      } else {
        // 退出代码块：重置语言标签
        codeBlockLang = ''
      }
      inCodeBlock = !inCodeBlock
      continue
    }

    // 跳过非 HTML 代码块内的内容
    if (inCodeBlock && codeBlockLang !== 'html') continue

    // 检查原始 <script> 标签
    if (/<script[\s>/]/i.test(line) || /<\/script>/i.test(line)) return true
    // 检查原始 <style> 标签（全局 CSS 泄漏）
    if (/<style[\s>/]/i.test(line) || /<\/style>/i.test(line)) return true
    // 检查 <link rel="stylesheet">（全局 CSS 泄漏）
    if (/<link[\s>]/i.test(line) && /rel\s*=\s*["']stylesheet["']/i.test(line)) return true
    // 检查内联事件处理器 onXxx="..."
    if (/\son\w+\s*=\s*["']/i.test(line)) return true
    // 检查 javascript: URL
    if (/href\s*=\s*["']\s*javascript:/i.test(line)) return true
    // 检查 <iframe> 嵌入
    if (/<iframe[\s>/]/i.test(line)) return true
  }
  return false
}

/** @deprecated 使用 contentNeedsIsolation */
export const contentHasScripts = contentNeedsIsolation
