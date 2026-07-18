import { onMounted, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useHealthStore } from '@/stores/health'
import { useSessionStore } from '@/stores/session'

/**
 * 健康轮询协调：启动后端健康轮询，并在后端从离线恢复到在线时兜底刷新会话列表。
 *
 * 修复背景：页面刷新时若后端仍在启动，initIfNeeded 的 refreshSessions 可能失败；
 * 此处在后端就绪后自动补刷会话列表。
 */
export function useHealthPolling() {
  const healthStore = useHealthStore()
  const sessionStore = useSessionStore()
  const { health } = storeToRefs(healthStore)

  onMounted(() => {
    healthStore.startPolling()
  })

  onUnmounted(() => {
    healthStore.stopPolling()
  })

  watch(health, (newHealth, oldHealth) => {
    if (!oldHealth && newHealth) {
      sessionStore.refreshSessions().catch((err) => console.warn('[App] refreshSessions failed:', err))
    }
  })

  return { health }
}
