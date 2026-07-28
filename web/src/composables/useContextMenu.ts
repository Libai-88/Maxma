import { computed, ref, type Ref } from 'vue'
import type { ParsedRef } from '@/utils/references'
import type { ContextMenuItem } from '@/components/ContextMenu.vue'
import type { ChatTurn } from '@/types'

const MAX_CITE_LENGTH = 1000

interface UseContextMenuOptions {
  turns: Ref<ChatTurn[]>
  emit: {
    (e: 'cite', ref: ParsedRef): void
    (e: 'action', p: { action: string; data?: unknown }): void
  }
}

/**
 * 聊天消息右键菜单：引用、复制、撤回
 */
export function useContextMenu({ turns, emit }: UseContextMenuOptions) {
  const ctxMenuVisible = ref(false)
  const ctxMenuPos = ref({ x: 0, y: 0 })
  const pendingCitation = ref<{ text: string } | null>(null)
  const pendingUserMsgIdx = ref<number | null>(null)

  const ctxMenuItems = computed((): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: '引用', action: 'cite', icon: 'cite-speech' },
      { label: '复制', action: 'copy', icon: 'copy' },
    ]
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
    _sourceType: string,
    fullText: string,
    _sourceLabel: string,
    userMsgIdx?: number,
  ) {
    pendingUserMsgIdx.value = userMsgIdx ?? null

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
      citeText = citeText.slice(0, MAX_CITE_LENGTH) + '…'
    }

    pendingCitation.value = { text: citeText }
    ctxMenuPos.value = { x: event.clientX, y: event.clientY }
    ctxMenuVisible.value = true
  }

  function handleContextMenuSelect(action: string) {
    if (action === 'cite' && pendingCitation.value) {
      const label = pendingCitation.value.text.length > 80
        ? pendingCitation.value.text.slice(0, 80) + '…'
        : pendingCitation.value.text
      const citeRef: ParsedRef = { type: 'cite', text: pendingCitation.value.text, label }
      emit('cite', citeRef)
    } else if (action === 'copy' && pendingCitation.value) {
      navigator.clipboard.writeText(pendingCitation.value.text)
    } else if (action === 'undo') {
      emit('action', { action: 'undo', data: { n: 1 } })
    }
    closeContextMenu()
  }

  function closeContextMenu() {
    ctxMenuVisible.value = false
    pendingCitation.value = null
    pendingUserMsgIdx.value = null
  }

  return {
    ctxMenuVisible,
    ctxMenuPos,
    ctxMenuItems,
    onBubbleContextMenu,
    handleContextMenuSelect,
    closeContextMenu,
  }
}
