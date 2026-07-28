import { nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { api } from '@/api'
import { isTauri } from '@/utils/env'
import { createLogger } from '@/utils/logger'
import type { FileRef, FolderRef, ParsedRef } from '@/utils/references'

const log = createLogger('ChatInput:AttachMenu')

interface UseAttachMenuOptions {
  disabled: Ref<boolean>
  refs: Ref<ParsedRef[]>
  loading: Ref<boolean>
}

/**
 * 附件菜单：文件/文件夹选择、键盘导航、路径阻挡检查
 */
export function useAttachMenu({ disabled, refs, loading }: UseAttachMenuOptions) {
  const showMenu = ref(false)
  const addFileMenuRef = ref<HTMLDivElement | null>(null)
  const addFileButtonRef = ref<HTMLButtonElement | null>(null)

  function getFileName(fp: string): string {
    const parts = fp.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || fp
  }

  function toggleMenu() {
    if (disabled.value) return
    showMenu.value = !showMenu.value
  }

  function getAddFileMenuItems(): HTMLElement[] {
    if (!addFileMenuRef.value) return []
    return Array.from(addFileMenuRef.value.querySelectorAll<HTMLElement>('[role="menuitem"]'))
  }

  function focusAddFileMenuItem(index: number) {
    const items = getAddFileMenuItems()
    const target = items[index]
    if (target) target.focus()
  }

  function closeAddFileMenu(returnFocus = true) {
    if (!showMenu.value) return
    showMenu.value = false
    if (returnFocus) {
      nextTick(() => addFileButtonRef.value?.focus())
    }
  }

  function onAddFileMenuKeydown(e: KeyboardEvent) {
    if (!showMenu.value) return
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        closeAddFileMenu(true)
        break
      case 'Tab':
        e.preventDefault()
        closeAddFileMenu(true)
        break
      case 'ArrowDown':
        e.preventDefault()
        {
          const items = getAddFileMenuItems()
          const current = document.activeElement
          const idx = current ? items.indexOf(current as HTMLElement) : -1
          const next = (idx + 1) % items.length
          focusAddFileMenuItem(next)
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        {
          const items = getAddFileMenuItems()
          const current = document.activeElement
          const idx = current ? items.indexOf(current as HTMLElement) : -1
          const prev = (idx - 1 + items.length) % items.length
          focusAddFileMenuItem(prev)
        }
        break
      case 'Home':
        e.preventDefault()
        focusAddFileMenuItem(0)
        break
      case 'End':
        e.preventDefault()
        {
          const items = getAddFileMenuItems()
          if (items.length > 0) focusAddFileMenuItem(items.length - 1)
        }
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        {
          const current = document.activeElement as HTMLElement | null
          if (current && current.getAttribute('role') === 'menuitem') {
            current.click()
          }
        }
        break
    }
  }

  // 菜单打开时聚焦第一个 menuitem
  watch(showMenu, async (val) => {
    if (val) {
      await nextTick()
      focusAddFileMenuItem(0)
    }
  })

  async function pickFile() {
    showMenu.value = false
    await _pick('file')
  }

  async function pickFolder() {
    showMenu.value = false
    await _pick('folder')
  }

  async function _pick(type: 'file' | 'folder') {
    if (loading.value) return
    loading.value = true
    try {
      const path = await selectLocalPath(type)
      if (path) {
        const refType = type === 'folder' ? 'folder' : 'file'
        refs.value.push({ type: refType, path, label: getFileName(path) } as ParsedRef)
        log.debug('_pick: pushed ref type=%s path=%s', refType, path)

        try {
          const result = await api.checkPathBlocked(path)
          log.debug('checkPathBlocked result for %s: %o', path, result)
          if (result.blocked) {
            const idx = refs.value.findIndex(r =>
              (r.type === 'file' || r.type === 'folder') && r.path === path
            )
            if (idx === -1) {
              log.debug('ref for path %s already removed, skipping', path)
              return
            }
            const entry = refs.value[idx] as FileRef | FolderRef
            entry.blocked = true
            entry.blockedReason = result.reason ?? undefined
            log.debug('marked ref %s as blocked, reason: %s', path, result.reason)
          }
        } catch (err) {
          log.warn('checkPathBlocked failed:', err)
        }
      }
    } catch {
      // 静默失败
    } finally {
      loading.value = false
    }
  }

  async function selectLocalPath(type: 'file' | 'folder'): Promise<string | null> {
    if (isTauri()) {
      const invoke = (window as any).__TAURI_INTERNALS__?.invoke ?? (window as any).__TAURI__?.core?.invoke
      if (invoke) return await invoke('select_path', { kind: type })
    }
    const data = await api.selectFile(type)
    return data.path
  }

  onMounted(() => {
    document.addEventListener('keydown', onAddFileMenuKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', onAddFileMenuKeydown)
  })

  return {
    showMenu,
    addFileMenuRef,
    addFileButtonRef,
    toggleMenu,
    closeAddFileMenu,
    pickFile,
    pickFolder,
    getFileName,
  }
}
