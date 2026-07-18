import { onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useSidebarStore } from '@/stores/sidebar'

/**
 * 侧边栏折叠状态管理
 *
 * 内部委托给 Pinia store（stores/sidebar.ts），
 * 使用 storeToRefs 避免 reactive 自动解包导致响应性丢失。
 * 通过 onMounted / onUnmounted 管理 matchMedia 监听器生命周期。
 */
export function useSidebar() {
  const store = useSidebarStore()

  onMounted(() => { store.init() })
  onUnmounted(() => { store.destroy() })

  const { effectiveCollapsed, userCollapsed } = storeToRefs(store)

  return {
    effectiveCollapsed,
    userCollapsed,
    toggleSidebar: store.toggleSidebar,
    setUserCollapsed: store.setUserCollapsed,
  }
}
