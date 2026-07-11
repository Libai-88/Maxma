import { onMounted, onUnmounted } from 'vue'

export interface GlobalShortcut {
  key: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
  allowInEditable?: boolean
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function matchesShortcut(event: KeyboardEvent, shortcut: GlobalShortcut): boolean {
  return event.key.toLowerCase() === shortcut.key.toLowerCase()
    && Boolean(event.ctrlKey || event.metaKey) === Boolean(shortcut.mod)
    && event.shiftKey === Boolean(shortcut.shift)
    && event.altKey === Boolean(shortcut.alt)
}

/** Registers one document-level shortcut and guarantees listener cleanup. */
export function useGlobalShortcut(shortcut: GlobalShortcut, callback: () => void): void {
  const listener = (event: KeyboardEvent) => {
    if (event.isComposing || event.key === 'Process') return
    if (!shortcut.allowInEditable && isEditableTarget(event.target)) return
    if (!matchesShortcut(event, shortcut)) return
    event.preventDefault()
    callback()
  }

  onMounted(() => document.addEventListener('keydown', listener))
  onUnmounted(() => document.removeEventListener('keydown', listener))
}
