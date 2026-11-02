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

/**
 * 能力清单的「为什么不可用」判定（CAP-HONESTY-001）。
 *
 * 后端 `routes/capabilities.ts` 特意把 `engine_supported` 与人类可读的 `reason`
 * 一起发出来（见 features.sub_agents），就是为了区分三件完全不同的事：
 *   - 引擎做不到（用户无论怎么设置都没用）
 *   - 用户自己关了（可以去设置里打开）
 *   - 当前部署根本没这条能力
 * 此前只有 `isFeatureEnabled()` 一个布尔出口，于是所有情况都被渲染成
 * 「此功能可能需要在设置中开启」——对 `sub_agents` 而言是把引擎的缺陷
 * 谎报成用户的操作。判定逻辑集中在这里，界面只负责照实说。
 */
export type FeatureAvailabilityKind =
  /** 清单尚未加载/后端不可达：无法判断，别猜。 */
  | 'manifest_unloaded'
  /** 清单显示该特性是开着的（落到不可用页通常是状态过期，应引导重新检测）。 */
  | 'available'
  /** 引擎不支持：用户改设置也没用。 */
  | 'engine_unsupported'
  /** 用户/面板把它关了：可操作。 */
  | 'user_disabled'
  /** 清单里压根没有这个特性：当前部署未包含。 */
  | 'not_deployed'

export interface FeatureAvailability {
  kind: FeatureAvailabilityKind
  /** 面向用户的中文说明；引擎侧 `reason` 存在时**原样透传**，不改写。 */
  reason: string
  /** 用户能否通过设置改变它（只有 user_disabled 为 true）。 */
  actionable: boolean
}

const ENGINE_UNSUPPORTED_FALLBACK = '当前 Agent 引擎不支持该能力，与你的设置无关'
const USER_DISABLED_REASON = '该功能当前在设置中被关闭，可以在对应设置面板里重新开启'
const NOT_DEPLOYED_REASON = '当前部署的能力清单未包含该特性，界面无法提供入口'
const MANIFEST_UNLOADED_REASON = '尚未取得后端能力清单，暂时无法判断该功能为何不可用'
const AVAILABLE_REASON = '能力清单显示该特性当前是启用的，可能是页面状态过期'

/**
 * 纯函数：给定能力清单的 features 集合与特性名，返回不可用的真实原因。
 * `features` 为 null/undefined 表示清单未加载。
 */
export function describeFeatureAvailability(
  features: CapabilityFeatures | null | undefined,
  name: string,
): FeatureAvailability {
  if (!features) return { kind: 'manifest_unloaded', reason: MANIFEST_UNLOADED_REASON, actionable: false }
  const cfg = features[name]
  if (!cfg) return { kind: 'not_deployed', reason: NOT_DEPLOYED_REASON, actionable: false }
  // engine_supported 只在后端确实不支持时才发 false；缺失按「支持」处理，
  // 由 enabled 分支决定结论（乐观默认，与 isFeatureEnabled 一致）。
  if (cfg.engine_supported === false) {
    const backendReason = typeof cfg.reason === 'string' ? cfg.reason.trim() : ''
    return {
      kind: 'engine_unsupported',
      reason: backendReason || ENGINE_UNSUPPORTED_FALLBACK,
      actionable: false,
    }
  }
  if (cfg.enabled === false) return { kind: 'user_disabled', reason: USER_DISABLED_REASON, actionable: true }
  return { kind: 'available', reason: AVAILABLE_REASON, actionable: false }
}

const log = createLogger('capabilities')

/** 默认刷新间隔（毫秒）—— 5 分钟。 */
export const CAPABILITIES_REFRESH_INTERVAL_MS = 5 * 60 * 1000

/**
 * 能力发现 Store（Phase 4）。
 *
 * 持有后端 GET /api/capabilities 返回的能力清单，提供：
 * - state：清单本体、loading、error、lastFetched
 * - actions：fetchCapabilities()（带并发去重）、refreshCapabilities()（强制刷新）
 * - getters：isFeatureEnabled(name)、getFeatureConfig(name)、describeFeature(name)、sidecarStatus、toolCount
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

  /** 某特性为何不可用（绑定当前清单的 store 出口，界面不必自己取 features）。 */
  function describeFeature(name: string): FeatureAvailability {
    return describeFeatureAvailability(capabilities.value?.features, name)
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
    describeFeature,
  }
})
