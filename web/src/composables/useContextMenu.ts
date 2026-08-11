import { computed, ref, type Ref } from 'vue'
import type { ParsedRef } from '@/utils/references'
import type { ContextMenuItem } from '@/components/ContextMenu.vue'
import { truncateWithEllipsis } from '@/utils/text'
import type { ChatTurn } from '@/types'
import { safeCopyText } from '@/lib/clipboard'
import { showError, showSuccess } from '@/lib/toast'

const MAX_CITE_LENGTH = 1000

interface UseContextMenuOptions {
  turns: Ref<ChatTurn[]>
  emit: {
    (e: 'cite', ref: ParsedRef): void
    (e: 'action', p: { action: string; data?: unknown }): void
  }
}

/**
 * 聊天消息右键菜单：引用、复制、重新生成、撤回
 */
export function useContextMenu({ turns, emit }: UseContextMenuOptions) {
  const ctxMenuVisible = ref(false)
  const ctxMenuPos = ref({ x: 0, y: 0 })
  const pendingCitation = ref<{ text: string } | null>(null)
  const pendingUserMsgIdx = ref<number | null>(null)
  // UX-REGEN-001：右键来源类型（assistant_message 时提供"重新生成"）
  const pendingSourceType = ref<string>('')

  const ctxMenuItems = computed((): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: '引用', action: 'cite', icon: 'cite-speech' },
      { label: '复制', action: 'copy', icon: 'copy' },
    ]
    // UX-REGEN-001：assistant 回复（finalAnswer 或 becameAnswer 的 thinking 块）
    // 上提供"重新生成"——撤回该轮及之后并重发
    if (
      (pendingSourceType.value === 'assistant_message' || pendingSourceType.value === 'thinking')
      && pendingUserMsgIdx.value !== null
    ) {
      items.push({ label: '重新生成', action: 'regenerate', icon: 'undo-arrow' })
    }
    if (
      pendingUserMsgIdx.value !== null
      && pendingUserMsgIdx.value === turns.value.length - 1
      && turns.value.length > 0
    ) {
      items.push({ label: '撤回', action: 'undo', icon: 'undo-arrow' })
    }
    return items
  })

  function onBubbleContextMenu(
    event: MouseEvent,
    sourceType: string,
    fullText: string,
    _sourceLabel: string,
    userMsgIdx?: number,
  ) {
    pendingUserMsgIdx.value = userMsgIdx ?? null
    pendingSourceType.value = sourceType

    let citeText = fullText

    const selection = window.getSelection()
    const selectedText = selection?.toString().trim()
    if (selectedText && selection!.rangeCount > 0) {
      const range = selection!.getRangeAt(0)
      const target = event.currentTarget as HTMLElement | null
      if (target && target.contains(range.commonAncestorContainer)) {
        citeText = selectedText
      }
      selection!.removeAllRanges()
    }

    if (!citeText) return

    if (citeText.length > MAX_CITE_LENGTH) {
      // 修复 TRUNCATE-001：码点安全截断，不切断 emoji 代理对
      citeText = truncateWithEllipsis(citeText, MAX_CITE_LENGTH)
    }

    pendingCitation.value = { text: citeText }
    // 修复 KEYBOARD-001：键盘触发（Shift+F10 / 菜单键）时无鼠标坐标，
    // 菜单定位到触发元素附近而非 (0,0) 角落。
    if (event instanceof KeyboardEvent) {
      const el = event.currentTarget as HTMLElement | null
      if (el) {
        const rect = el.getBoundingClientRect()
        ctxMenuPos.value = { x: Math.round(rect.left), y: Math.round(rect.bottom) }
      } else {
        ctxMenuPos.value = { x: 0, y: 0 }
      }
    } else {
      ctxMenuPos.value = { x: event.clientX, y: event.clientY }
    }
    ctxMenuVisible.value = true
  }

  /** 键盘打开上下文菜单（Shift+F10 / ContextMenu 键）。 */
  function onBubbleContextMenuKeydown(event: KeyboardEvent, sourceType: string, fullText: string, sourceLabel: string, userMsgIdx?: number) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    onBubbleContextMenu(event as unknown as MouseEvent, sourceType, fullText, sourceLabel, userMsgIdx)
  }

  function handleContextMenuSelect(action: string) {
    if (action === 'cite' && pendingCitation.value) {
      const label = pendingCitation.value.text.length > 80
        ? pendingCitation.value.text.slice(0, 80) + '…'
        : pendingCitation.value.text
      const citeRef: ParsedRef = { type: 'cite', text: pendingCitation.value.text, label }
      emit('cite', citeRef)
    } else if (action === 'copy' && pendingCitation.value) {
      // UX-COPY-FEEDBACK-001：复制成功/失败给出明确反馈（此前返回值被忽略，
      // 复制失败时用户粘贴才发现）
      void safeCopyText(pendingCitation.value.text).then((ok) => {
        if (ok) showSuccess('已复制到剪贴板')
        else showError('复制失败，请手动选择文本复制')
      })
    } else if (action === 'regenerate') {
      emit('action', { action: 'regenerate', data: { index: pendingUserMsgIdx.value } })
    } else if (action === 'undo') {
      emit('action', { action: 'undo', data: { n: 1 } })
    }
    closeContextMenu()
  }

  function closeContextMenu() {
    ctxMenuVisible.value = false
    pendingCitation.value = null
    pendingUserMsgIdx.value = null
    pendingSourceType.value = ''
  }

  return {
    ctxMenuVisible,
    ctxMenuPos,
    ctxMenuItems,
    onBubbleContextMenu,
    onBubbleContextMenuKeydown,
    handleContextMenuSelect,
    closeContextMenu,
  }
}
