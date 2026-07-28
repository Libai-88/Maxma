import { nextTick, ref, type Ref } from 'vue'
import type { ParsedRef } from '@/utils/references'

const LINK_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i

interface UseLinkInputOptions {
  refs: Ref<ParsedRef[]>
  showMenu: Ref<boolean>
  textareaRef: Ref<HTMLTextAreaElement | null>
}

/**
 * 链接引用输入：URL 校验、规范化、粘贴识别
 */
export function useLinkInput({ refs, showMenu, textareaRef }: UseLinkInputOptions) {
  const showLinkInput = ref(false)
  const linkUrl = ref('')
  const linkError = ref<string | null>(null)
  const linkInputRef = ref<HTMLInputElement | null>(null)

  function startLinkInput(initialUrl?: string | MouseEvent) {
    showMenu.value = false
    linkUrl.value = typeof initialUrl === 'string' ? initialUrl : ''
    linkError.value = null
    showLinkInput.value = true
    nextTick(() => linkInputRef.value?.focus())
  }

  function confirmLink() {
    const url = linkUrl.value.trim()
    linkError.value = null
    if (!url) {
      linkError.value = '请输入有效链接'
      return
    }
    const normalized = /^https?:\/\//i.test(url) ? url : 'https://' + url
    if (!LINK_RE.test(normalized)) {
      linkError.value = '请输入有效链接'
      return
    }
    try {
      const domain = new URL(normalized).hostname.replace(/^www\./, '')
      refs.value.push({ type: 'web_link', url: normalized, label: domain, domain })
      linkUrl.value = ''
      linkError.value = null
      showLinkInput.value = false
      nextTick(() => textareaRef.value?.focus())
    } catch {
      linkError.value = '请输入有效链接'
    }
  }

  function cancelLink() {
    linkUrl.value = ''
    linkError.value = null
    showLinkInput.value = false
    nextTick(() => textareaRef.value?.focus())
  }

  /** 判断文本是否看起来像域名/IP */
  function looksLikeHost(text: string): boolean {
    return /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:[0-9]+)?(\/|$)/.test(text)
        || /^localhost(:[0-9]+)?(\/|$)/i.test(text)
  }

  /** 粘贴事件中的链接识别（在 onPaste 中调用） */
  function handlePasteLink(e: ClipboardEvent): boolean {
    const text = e.clipboardData?.getData('text/plain')?.trim()
    if (!text) return false

    if (/^https?:\/\//i.test(text)) {
      try {
        const url = new URL(text)
        if (['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.')) {
          e.preventDefault()
          startLinkInput(text)
          return true
        }
      } catch { /* 走默认粘贴 */ }
      return false
    }

    if (looksLikeHost(text)) {
      const normalized = 'https://' + text
      try {
        const url = new URL(normalized)
        if (['http:', 'https:'].includes(url.protocol)) {
          e.preventDefault()
          startLinkInput(normalized)
          return true
        }
      } catch { /* 走默认粘贴 */ }
    }
    return false
  }

  return {
    showLinkInput,
    linkUrl,
    linkError,
    linkInputRef,
    startLinkInput,
    confirmLink,
    cancelLink,
    handlePasteLink,
  }
}
