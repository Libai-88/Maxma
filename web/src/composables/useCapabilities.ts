import { onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import {
  CAPABILITIES_REFRESH_INTERVAL_MS,
  useCapabilitiesStore,
} from '@/stores/capabilities'
import type { CapabilityFeatureConfig } from '@/types'
import { createLogger } from '@/utils/logger'

const log = createLogger('capabilities')

// 模块级单一定时器：多个组件共用同一个轮询循环，避免重复请求。
let _refTimer: ReturnType<typeof setInterval> | null = null
let _refCount = 0

function _startSharedPolling(intervalMs: number) {
  _refCount++
  if (_refTimer !== null) return
  const store = useCapabilitiesStore()
  _refTimer = setInterval(() => {
    void store.refreshCapabilities()
  }, intervalMs)
}

function _stopSharedPolling() {
  _refCount = Math.max(0, _refCount - 1)
  if (_refCount === 0 && _refTimer !== null) {
    clearInterval(_refTimer)
    _refTimer = null
  }
}

/**
 * 应用初始化时调用一次：立即拉取能力清单并启动 5 分钟后台轮询。
 * 与组件级 useCapabilities() 共享同一定时器，可在 main.ts / App.vue 中调用。
 * 失败静默处理（store 内部保留 last-known-good）。
 */
export function initCapabilities(intervalMs = CAPABILITIES_REFRESH_INTERVAL_MS): void {
  const store = useCapabilitiesStore()
  void store.fetchCapabilities().catch((e) => log.warn('init fetch failed:', e))
  _startSharedPolling(intervalMs)
}

/**
 * 能力发现 composable（Phase 4）。
 *
 * - 挂载时确保清单已加载并加入共享轮询；卸载时退出轮询。
 * - 提供响应式 capabilities / loading / error / lastFetched。
 * - 提供 hasFeature(name) 与 getFeatureConfig(name) 辅助函数。
 * - 离线/错误时回退到 store 中的 last-known-good 数据或乐观默认。
 */
export function useCapabilities(intervalMs = CAPABILITIES_REFRESH_INTERVAL_MS) {
  const store = useCapabilitiesStore()
  const { capabilities, loading, error, lastFetched, sidecarStatus, toolCount, version } =
    storeToRefs(store)

  onMounted(() => {
    _startSharedPolling(intervalMs)
    // 首次加载（store 内部对并发去重）
    if (!capabilities.value) {
      void store.fetchCapabilities()
    }
  })

  onUnmounted(() => {
    _stopSharedPolling()
  })

  /** 特性是否启用（清单未加载时乐观返回 true）。 */
  function hasFeature(name: string): boolean {
    return store.isFeatureEnabled(name)
  }

  /** 读取特性配置对象（缺失返回空对象）。 */
  function getFeatureConfig(name: string): CapabilityFeatureConfig {
    return store.getFeatureConfig(name)
  }

  /** 按需刷新。 */
  function refresh(): Promise<void> {
    return store.refreshCapabilities()
  }

  return {
    capabilities,
    loading,
    error,
    lastFetched,
    sidecarStatus,
    toolCount,
    version,
    hasFeature,
    getFeatureConfig,
    refresh,
  }
}
