import { useEffect } from 'react'
import { toast } from 'sonner'
import { useSessionStore } from '@/stores/session'
import { useOnboardingStore } from '@/stores/onboarding'
import { useCapabilitiesStore } from '@/stores/capabilities'
import { useHealthStore } from '@/stores/health'
import { flushAllTurnsOnPageLeave } from '@/hooks/useChat'
import { CAPABILITIES_REFRESH_INTERVAL_MS } from '@/stores/capabilities'
import { createLogger } from '@/utils/logger'

const log = createLogger('appInit')

/** 对应旧 App.vue 的 onMounted：会话初始化 / 引导 / 能力发现 / 健康轮询 / 全局事件与快捷键。 */
export function useAppInit() {
  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const session = useSessionStore.getState()
    const onboarding = useOnboardingStore.getState()
    const caps = useCapabilitiesStore.getState()
    const health = useHealthStore.getState()

    void session.initIfNeeded().then((ok) => {
      if (!ok && !cancelled) {
        toast.error('会话初始化失败，请检查后端服务后重试')
        // SESSION-INIT-001：10s 后自动恢复，避免卡在「空会话 + 不可发送」。
        retryTimer = setTimeout(() => {
          void session.initIfNeeded().then((ok2) => {
            if (ok2) toast.success('会话已恢复')
            else toast.error('会话初始化失败，正在自动重试…')
          })
        }, 10000)
      }
    })
    void onboarding.initialize()
    void caps.fetchCapabilities().catch(() => {})
    health.startPolling()

    const capTimer = setInterval(() => {
      void useCapabilitiesStore.getState().refreshCapabilities().catch(() => {})
    }, CAPABILITIES_REFRESH_INTERVAL_MS)

    // 全局 toast 通道（旧 maxma:toast / maxma:error）
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string; level?: string }>).detail ?? {}
      const message = detail.message || '发生了意外错误'
      const level = detail.level || 'info'
      if (level === 'error') toast.error(message)
      else if (level === 'success') toast.success(message)
      else if (level === 'warning') toast.warning(message)
      else toast(message)
    }
    const onError = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail ?? {}
      toast.error(detail.message || '发生了意外错误')
    }
    window.addEventListener('maxma:toast', onToast)
    window.addEventListener('maxma:error', onError)

    // 页面切后台暂停装饰动画
    const onVisibility = () => document.documentElement.classList.toggle('animations-paused', document.hidden)
    document.addEventListener('visibilitychange', onVisibility)

    // 刷新/关闭窗口前把进行中的轮次落盘
    window.addEventListener('pagehide', flushAllTurnsOnPageLeave)

    // 全局快捷键：Ctrl/Cmd+N 新建会话、Ctrl/Cmd+L 聚焦输入框
    const onShortcut = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void useSessionStore.getState().createSession().then(() => window.dispatchEvent(new CustomEvent('maxma:navigate', { detail: '/' })))
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('maxma:focus-input'))
      }
    }
    window.addEventListener('keydown', onShortcut)

    // 健康恢复后补刷会话列表
    let hadHealth = !!useHealthStore.getState().health
    const unsubHealth = useHealthStore.subscribe((state) => {
      const has = !!state.health
      if (!hadHealth && has) void useSessionStore.getState().refreshSessions().catch((err) => log.warn('refreshSessions failed:', err))
      hadHealth = has
    })

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearInterval(capTimer)
      window.removeEventListener('maxma:toast', onToast)
      window.removeEventListener('maxma:error', onError)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flushAllTurnsOnPageLeave)
      window.removeEventListener('keydown', onShortcut)
      unsubHealth()
      useHealthStore.getState().stopPolling()
    }
  }, [])
}
