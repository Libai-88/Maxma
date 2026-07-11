import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api'
import type { ProviderConfig } from '@/types'

/**
 * Provider 全局状态 store
 *
 * 此前 ChatView、ChatInput、ProvidersView 各自独立调用 api.listProviders()，
 * 无共享状态。ChatInput 的 loadProviders 失败时静默 catch 无重试，导致
 * 输入框显示"未配置模型"但 ChatView 显示聊天界面的不一致问题。
 *
 * 统一通过 store 管理 provider 列表，消除竞态和状态不一致。
 */
export const useProviderStore = defineStore('provider', () => {
  /** 所有 provider（含已禁用的，供 ProvidersView 管理用） */
  const allProviders = ref<ProviderConfig[]>([])
  /** 已启用的 provider 列表（供 ChatView/ChatInput 使用） */
  const enabledProviders = computed(() => allProviders.value.filter(p => p.enabled))
  /** 是否有已启用的 provider */
  const hasProviders = computed(() => enabledProviders.value.length > 0)
  /** Providers with a safe runtime reason code that UI surfaces can consume. */
  const providersNeedingAttention = computed(() => allProviders.value.filter(provider =>
    provider.health_status === 'degraded' || provider.health_status === 'error',
  ))
  /** 加载状态 */
  const loading = ref(false)
  /** 是否已成功加载过至少一次 */
  const loaded = ref(false)
  /** 进行中的加载 promise（并发调用时复用，避免竞态） */
  let _loadingPromise: Promise<void> | null = null

  /**
   * 从后端加载 provider 列表
   * 失败时自动重试最多 3 次，间隔递增
   * 并发调用时复用同一个 promise，避免竞态
   */
  function loadProviders(retries = 3): Promise<void> {
    if (_loadingPromise) return _loadingPromise
    loading.value = true
    _loadingPromise = (async () => {
      try {
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const res = await api.listProviders()
            allProviders.value = res.providers
            loaded.value = true
            return
          } catch (e) {
            if (attempt < retries) {
              // 递增等待：200ms, 400ms, 800ms
              await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)))
            } else {
              // 最后一次仍失败：保留现有数据（首次加载时为空数组）
              console.warn('[providerStore] 加载 provider 列表失败（已重试', retries, '次）:', e)
            }
          }
        }
      } finally {
        loading.value = false
        _loadingPromise = null
      }
    })()
    return _loadingPromise
  }

  /** 供 ProvidersView 在增删改后刷新（强制重新加载，不重试） */
  async function refresh(): Promise<void> {
    // 等待进行中的加载完成（如果有），再强制重新加载
    if (_loadingPromise) await _loadingPromise
    _loadingPromise = null
    loading.value = false
    await loadProviders(0)
  }

  return {
    allProviders,
    enabledProviders,
    hasProviders,
    providersNeedingAttention,
    loading,
    loaded,
    loadProviders,
    refresh,
  }
})
