import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api'
import type {
  CapabilitiesResponse,
  CapabilityFeatures,
  CapabilityFeatureConfig,
  SidecarStatus,
} from '@/types'
import { createLogger } from '@/utils/logger'

const log = createLogger('capabilities')

/** 默认刷新间隔（毫秒）—— 5 分钟。 */
export const CAPABILITIES_REFRESH_INTERVAL_MS = 5 * 60 * 1000

/**
 * 能力发现 Store（Phase 4）。
 *
 * 持有后端 GET /api/capabilities 返回的能力清单，提供：
 * - state：清单本体、loading、error、lastFetched
 * - actions：fetchCapabilities()（带并发去重）、refreshCapabilities()（强制刷新）
 * - getters：isFeatureEnabled(name)、getFeatureConfig(name)、sidecarStatus、toolCount
 *
 * 失败时保留上一次成功的清单（last-known-good），避免界面因瞬时离线而抖动。
 */
export const useCapabilitiesStore = defineStore('capabilities', () => {
  // ── State ──
  const capabilities = ref<CapabilitiesResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const lastFetched = ref<number | null>(null)

  // 并发去重：同一时刻仅允许一个 in-flight 请求
  let _inflight: Promise<void> | null = null

  // ── Actions ──

  /**
   * 拉取能力清单。若已有请求在途则复用其 Promise，避免重复请求。
   * 失败时保留 last-known-good 数据，仅更新 error。
   */
  async function fetchCapabilities(): Promise<void> {
    if (_inflight) return _inflight
    loading.value = true
    error.value = null
    _inflight = (async () => {
      try {
        const data = await api.getCapabilities()
        capabilities.value = data
        lastFetched.value = Date.now()
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
        log.warn('fetchCapabilities failed (keeping last-known-good):', error.value)
      } finally {
        loading.value = false
        _inflight = null
      }
    })()
    return _inflight
  }

  /** 强制刷新（语义上等同于 fetchCapabilities，保留独立入口便于调用方表达意图）。 */
  async function refreshCapabilities(): Promise<void> {
    return fetchCapabilities()
  }

  // ── Getters ──

  const features = computed<CapabilityFeatures>(() => capabilities.value?.features ?? {})

  /**
   * 判断某特性是否启用。
   * 规则：清单尚未加载时返回 true（乐观默认，避免在加载期间误隐藏核心导航）；
   * 已加载但特性缺失时返回 false；存在 enabled 字段时以其为准。
   */
  function isFeatureEnabled(name: string): boolean {
    const manifest = capabilities.value
    if (!manifest || !manifest.features) return true
    const feature = manifest.features[name]
    if (!feature) return false
    return feature.enabled !== false
  }

  /** 读取某特性的完整配置对象（缺失时返回空对象）。 */
  function getFeatureConfig(name: string): CapabilityFeatureConfig {
    return capabilities.value?.features?.[name] ?? {}
  }

  const sidecarStatus = computed<SidecarStatus | null>(
    () => capabilities.value?.sidecar ?? null,
  )

  const toolCount = computed<number>(() => {
    const t = capabilities.value?.features?.tools
    if (!t) return capabilities.value?.tools?.length ?? 0
    const builtin = typeof t.builtin_count === 'number' ? t.builtin_count : 0
    const custom = typeof t.custom_count === 'number' ? t.custom_count : 0
    return builtin + custom
  })

  const version = computed<string | undefined>(() => capabilities.value?.version)

  return {
    // state
    capabilities,
    loading,
    error,
    lastFetched,
    // getters
    features,
    sidecarStatus,
    toolCount,
    version,
    // actions
    fetchCapabilities,
    refreshCapabilities,
    isFeatureEnabled,
    getFeatureConfig,
  }
})
