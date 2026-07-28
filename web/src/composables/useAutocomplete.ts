/**
 * useAutocomplete — # 触发的工具自动补全状态机
 *
 * 从 ChatInput.vue 提取的纯逻辑 composable。
 * 管理触发检测、候选项过滤排序、键盘导航、确认选择。
 */
import { ref, computed, watch, nextTick, type Ref } from 'vue'
import { api } from '@/api'
import { createLogger } from '@/utils/logger'
import type { ToolInfo } from '@/types'
import type { ParsedRef } from '@/utils/references'

const log = createLogger('autocomplete')

type AcMode = 'tool' | null

export interface UseAutocompleteOptions {
  text: Ref<string>
  textareaRef: Ref<HTMLTextAreaElement | null>
  refs: Ref<ParsedRef[]>
  connectionError: Ref<string | null>
  onConfirm?: () => void
}

export function useAutocomplete(options: UseAutocompleteOptions) {
  const { text, textareaRef, refs, connectionError, onConfirm } = options

  const acMode = ref<AcMode>(null)
  const acFilterText = ref('')
  const acPosition = ref({ x: 0, y: 0 })
  const acActiveIndex = ref(0)
  const acTriggerPos = ref(-1)
  const acTriggerChar = ref('')

  const tools = ref<ToolInfo[]>([])

  const acSource = computed(() =>
    acMode.value === 'tool' ? tools.value : []
  )

  const acFiltered = computed(() => {
    const src = acSource.value
    if (!acFilterText.value) return src
    const lower = acFilterText.value.toLowerCase()

    const scored = src
      .map(item => {
        const nameLower = item.name.toLowerCase()
        if (!nameLower.includes(lower)) return null
        const prefix = nameLower.startsWith(lower)
        const count = prefix ? 1 : nameLower.split(lower).length - 1
        const score = prefix ? 4 : 2
        return { item, score, count }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      if (a.count !== b.count) return b.count - a.count
      return a.item.name.localeCompare(b.item.name)
    })

    return scored.map(s => s.item)
  })

  async function loadTools() {
    try {
      const res = await api.listTools()
      tools.value = res.tools
    } catch (e) {
      log.error('加载工具失败:', e)
    }
  }

  // 检测 # 触发 (tool autocomplete)
  watch(text, () => {
    if (connectionError.value) connectionError.value = null
    const el = textareaRef.value
    if (!el || el !== document.activeElement) return
    const val = text.value
    const cursorPos = el.selectionStart
    const textBeforeCursor = val.slice(0, cursorPos)

    let triggerPos = -1
    let triggerChar = ''
    for (const ch of ['#'] as const) {
      const idx = textBeforeCursor.lastIndexOf(ch)
      if (idx > triggerPos) {
        triggerPos = idx
        triggerChar = ch
      }
    }

    const mode: AcMode = triggerChar === '#' ? 'tool' : null

    if (triggerPos !== -1 && mode) {
      const after = textBeforeCursor.slice(triggerPos + 1)
      const charBefore = triggerPos === 0 ? ' ' : textBeforeCursor[triggerPos - 1]
      if (!/\w/.test(charBefore)) {
        acMode.value = mode
        acFilterText.value = after
        acTriggerPos.value = triggerPos
        acTriggerChar.value = triggerChar
        acActiveIndex.value = 0
        acPosition.value = calcCursorPixelPos(el, cursorPos)
        return
      }
    }
    acMode.value = null
  })

  /**
   * 处理键盘事件。返回 true 表示已消费（调用方不再处理）。
   */
  function handleKeydown(e: KeyboardEvent): boolean {
    if (acMode.value) {
      const len = acFiltered.value.length
      if (e.key === 'Tab') {
        e.preventDefault()
        confirmItem()
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        acActiveIndex.value = ((acActiveIndex.value - 1) % len + len) % len
        return true
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        acActiveIndex.value = (acActiveIndex.value + 1) % len
        return true
      }
      if (e.key === 'Escape') {
        acMode.value = null
        return true
      }
    }
    return false
  }

  function confirmItem() {
    const item = acFiltered.value[acActiveIndex.value]
    if (!item) return

    const el = textareaRef.value
    const cursorPos = el?.selectionStart ?? text.value.length
    text.value = text.value.slice(0, acTriggerPos.value) + text.value.slice(cursorPos)

    const parsedRef: ParsedRef =
      { type: 'tool', name: item.name, label: item.name }
    refs.value.push(parsedRef)

    acMode.value = null
    nextTick(() => onConfirm?.())
  }

  function calcCursorPixelPos(textarea: HTMLTextAreaElement, pos: number): { x: number; y: number } {
    const style = getComputedStyle(textarea)
    const mirror = document.createElement('div')
    mirror.style.cssText = `
      position: fixed; top: 0; left: -9999px; visibility: hidden; white-space: pre-wrap;
      word-wrap: break-word; overflow-wrap: break-word;
      font: ${style.font}; font-size: ${style.fontSize};
      letter-spacing: ${style.letterSpacing};
      width: ${textarea.clientWidth}px;
      padding: ${style.padding};
    `
    mirror.textContent = textarea.value.slice(0, pos) + '.'
    document.body.appendChild(mirror)

    const textareaRect = textarea.getBoundingClientRect()
    const mirrorRect = mirror.getBoundingClientRect()

    const lines = mirror.textContent!.split('\n')
    const lastLine = lines[lines.length - 1]

    const span = document.createElement('span')
    span.textContent = lastLine
    span.style.cssText = `visibility: hidden; white-space: pre; font: ${style.font}; font-size: ${style.fontSize};`
    document.body.appendChild(span)

    const x = textareaRect.left + span.getBoundingClientRect().width + parseInt(style.paddingLeft || '0') - 8
    const y = textareaRect.top + mirrorRect.height - textarea.scrollTop + 4

    document.body.removeChild(mirror)
    document.body.removeChild(span)

    return { x, y }
  }

  return {
    // state
    acMode,
    acFilterText,
    acPosition,
    acActiveIndex,
    acFiltered,
    tools,
    // actions
    loadTools,
    handleKeydown,
    confirmItem,
  }
}
