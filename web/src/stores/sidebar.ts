import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'maxma_sidebar_collapsed'

export const useSidebarStore = defineStore('sidebar', () => {
  const userCollapsed = ref(false)
  const forcedCollapsed = ref(false)
  let mql: MediaQueryList | null = null

  function onMqlChange(e: MediaQueryListEvent) {
    forcedCollapsed.value = e.matches
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, String(userCollapsed.value)) } catch { /* noop */ }
  }

  function loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved !== null) userCollapsed.value = saved === 'true'
    } catch { /* noop */ }
  }

  function init() {
    loadFromStorage()
    mql = window.matchMedia('(max-width: 900px)')
    forcedCollapsed.value = mql.matches
    mql.addEventListener('change', onMqlChange)
  }

  function destroy() {
    if (mql) {
      mql.removeEventListener('change', onMqlChange)
      mql = null
    }
  }

  const effectiveCollapsed = computed(() => userCollapsed.value || forcedCollapsed.value)

  function toggleSidebar() {
    userCollapsed.value = !userCollapsed.value
    persist()
  }

  function setUserCollapsed(v: boolean) {
    userCollapsed.value = v
    persist()
  }

  return {
    effectiveCollapsed,
    userCollapsed,
    toggleSidebar,
    setUserCollapsed,
    init,
    destroy,
  }
})
