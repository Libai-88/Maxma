// web/src/composables/useSelectionQuote.ts
import { ref, onMounted, onUnmounted } from 'vue'

export interface QuotedSelection {
  id: string
  text: string
  source: string // 来源标签（如 '用户' / 'AI' / '思考过程'）
  rect: { left: number; top: number; width: number; height: number }
}

export interface QuoteCandidate {
  text: string
  source: string
  rect: DOMRect
}

const quoteCandidate = ref<QuoteCandidate | null>(null)
const quotedSelections = ref<QuotedSelection[]>([])

let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null

/** 引用计数器：跟踪 useSelectionQuote 活跃实例数 */
let instanceCount = 0
let listenersRegistered = false

function getSelectionSource(): string {
  // 通过 data-source 属性或最近的 cite-source 元素判断来源
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return '未知'
  const range = selection.getRangeAt(0)
  let node: Node | null = range.commonAncestorContainer
  while (node && node !== document.body) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.dataset?.source) return el.dataset.source
      // 从 cite-source 的 contextmenu data 推断
      const citeSource = el.closest?.('[data-source]')
      if (citeSource) return citeSource.getAttribute('data-source') || '未知'
    }
    node = node.parentNode
  }
  return '对话'
}

function checkSelection() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    quoteCandidate.value = null
    return
  }

  const text = selection.toString().trim()
  if (text.length < 2) {
    quoteCandidate.value = null
    return
  }

  // 确保选区在对话区域内
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  // nodeType 检查不会自动收窄为 Element，需显式断言
  const containerEl: Element | null =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : container.parentElement
  const chatWindow = containerEl?.closest('.chat-window, .messages-list')
  if (!chatWindow) {
    quoteCandidate.value = null
    return
  }

  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    quoteCandidate.value = null
    return
  }

  quoteCandidate.value = {
    text,
    source: getSelectionSource(),
    rect,
  }
}

function onSelectionChange() {
  // 防抖：selectionchange 频繁触发
  if (selectionChangeTimer) clearTimeout(selectionChangeTimer)
  selectionChangeTimer = setTimeout(checkSelection, 100)
}

function onMouseUp() {
  // mouseup 后稍等，确保 selection 已更新
  setTimeout(checkSelection, 10)
}

function commitCandidate(): boolean {
  if (!quoteCandidate.value) return false
  const c = quoteCandidate.value
  quotedSelections.value.push({
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: c.text,
    source: c.source,
    rect: { left: c.rect.left, top: c.rect.top, width: c.rect.width, height: c.rect.height },
  })
  // 清除选区
  window.getSelection()?.removeAllRanges()
  quoteCandidate.value = null
  return true
}

function removeQuote(id: string) {
  quotedSelections.value = quotedSelections.value.filter(q => q.id !== id)
}

function clearQuotes() {
  quotedSelections.value = []
}

export function useSelectionQuote() {
  // 单次注册监听器：使用引用计数避免 HMR 或重复调用导致重复监听
  onMounted(() => {
    instanceCount++
    if (!listenersRegistered) {
      document.addEventListener('selectionchange', onSelectionChange)
      document.addEventListener('mouseup', onMouseUp)
      listenersRegistered = true
    }
  })
  onUnmounted(() => {
    instanceCount--
    if (instanceCount <= 0 && listenersRegistered) {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mouseup', onMouseUp)
      listenersRegistered = false
    }
    if (selectionChangeTimer) clearTimeout(selectionChangeTimer)
  })

  return {
    quoteCandidate,
    quotedSelections,
    commitCandidate,
    removeQuote,
    clearQuotes,
  }
}
