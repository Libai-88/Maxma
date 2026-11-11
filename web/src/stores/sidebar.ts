import { create } from 'zustand'

const STORAGE_KEY = 'maxma_sidebar_collapsed'

interface SidebarState {
  effectiveCollapsed: boolean
  userCollapsed: boolean
  forcedCollapsed: boolean
  toggleSidebar: () => void
  setUserCollapsed: (v: boolean) => void
  init: () => void
  destroy: () => void
}

export const useSidebarStore = create<SidebarState>()((set, get) => {
  let mql: MediaQueryList | null = null

  function patch(p: Partial<SidebarState>) {
    set((s) => {
      const userCollapsed = p.userCollapsed ?? s.userCollapsed
      const forcedCollapsed = p.forcedCollapsed ?? s.forcedCollapsed
      return { ...p, effectiveCollapsed: userCollapsed || forcedCollapsed }
    })
  }

  function onMqlChange(e: MediaQueryListEvent) {
    patch({ forcedCollapsed: e.matches })
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, String(get().userCollapsed)) } catch { /* noop */ }
  }

  function loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved !== null) patch({ userCollapsed: saved === 'true' })
    } catch { /* noop */ }
  }

  function init() {
    loadFromStorage()
    mql = window.matchMedia('(max-width: 900px)')
    patch({ forcedCollapsed: mql.matches })
    mql.addEventListener('change', onMqlChange)
  }

  function destroy() {
    if (mql) {
      mql.removeEventListener('change', onMqlChange)
      mql = null
    }
  }

  function toggleSidebar() {
    patch({ userCollapsed: !get().userCollapsed })
    persist()
  }

  function setUserCollapsed(v: boolean) {
    patch({ userCollapsed: v })
    persist()
  }

  return {
    effectiveCollapsed: false,
    userCollapsed: false,
    forcedCollapsed: false,
    toggleSidebar,
    setUserCollapsed,
    init,
    destroy,
  }
})
