/**
 * 会话内用量徽标的状态机（PLUGIN-001 / P7）。
 *
 * 折叠态**文案**的口径由搬运过来的 `badgeView()` 负责，已由插件自带的 74 条单测锁住
 * （`jetHubBadgeModel.spec.ts`）。这里锁的是**取数与轮询**这一层，重点是插件踩过坑、
 * 明确要求保留的两个行为：
 *
 *   1. **首次读数未回 ≠ 没有账号**。前者必须走 `loading`，否则首屏会说
 *      「未配置启用账号」，用户以为账号丢了（插件 2026-10-02 的真实报障）。
 *   2. **读失败保留上次读数**。一次网络抖动不该让徽标变空；只有「首次且无数据」
 *      才进 failed（显示「用量不可用」）。
 *
 * 另外锁住偏好写入：插件会拒绝非法值，界面只发 auto/subscription/credits 三种。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const requestMock = vi.fn()
const callJetHubMock = vi.fn()

vi.mock('@/api', () => ({
  request: (...args: unknown[]) => requestMock(...args),
  callJetHub: (...args: unknown[]) => callJetHubMock(...args),
}))

async function loadStore() {
  vi.resetModules()
  const mod = await import('../src/stores/jetHub')
  return mod.useJetHubStore()
}

const ROUTES = [{ id: 'trae', name: 'TRAE (字节)' }]

function reading(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'trae',
    generatedAt: 1_791_448_927_651,
    cached: false,
    accounts: [],
    disabledCount: 0,
    windowDays: 15,
    preference: 'auto',
    ...overrides,
  }
}

function transport(badgeImpl: () => unknown) {
  requestMock.mockImplementation(async () => ({ providers: ROUTES }))
  callJetHubMock.mockImplementation(async (method: string) => {
    if (method === 'provider.status') return { statuses: {} }
    if (method === 'account.list') return { accounts: [] }
    if (method === 'usage.badge') return badgeImpl()
    if (method === 'usage.badgePreference') return { preference: 'auto' }
    return {}
  })
}

function badgeCalls() {
  return callJetHubMock.mock.calls.filter(([m]) => m === 'usage.badge').map(([, p]) => p)
}

describe('Jet Hub 用量徽标', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestMock.mockReset()
    callJetHubMock.mockReset()
  })

  it('取数传 { provider }，force 时才带上 force', async () => {
    transport(() => reading())
    const store = await loadStore()

    await store.loadBadgeProvider('trae')
    await store.loadBadgeProvider('trae', { force: true })

    expect(badgeCalls()).toEqual([{ provider: 'trae' }, { provider: 'trae', force: true }])
    expect(store.badge?.provider).toBe('trae')
    expect(store.badgeLoading).toBe(false)
    expect(store.badgeFailed).toBe(false)
  })

  it('空 provider 不发请求（非插件渠道不打扰后端）', async () => {
    transport(() => reading())
    const store = await loadStore()

    expect(await store.loadBadgeProvider('')).toBeNull()
    expect(badgeCalls()).toHaveLength(0)
  })

  it('首次读失败 → failed（界面显示「用量不可用」而不是「没有账号」）', async () => {
    transport(() => {
      throw Object.assign(new Error('unsupported provider: trae'), { code: 'bad-request' })
    })
    const store = await loadStore()

    await expect(store.loadBadgeProvider('trae')).rejects.toThrow('unsupported provider')
    expect(store.badgeFailed).toBe(true)
    expect(store.badge).toBeNull()
    expect(store.badgeError).toContain('unsupported provider')
  })

  it('后续读失败保留上次读数，且不把 failed 置起来', async () => {
    let calls = 0
    transport(() => {
      calls += 1
      if (calls === 1) return reading({ accounts: [{ accountId: 'a1' }] })
      throw Object.assign(new Error('网关抖动'), { code: 'jet-hub/handler-failed' })
    })
    const store = await loadStore()

    await store.loadBadgeProvider('trae')
    expect(store.badge?.accounts).toHaveLength(1)

    await expect(store.loadBadgeProvider('trae')).rejects.toThrow('网关抖动')
    // 关键：上次读数还在，failed 不置起 —— 徽标不会变空
    expect(store.badge?.accounts).toHaveLength(1)
    expect(store.badgeFailed).toBe(false)
    expect(store.badgeError).toBe('网关抖动')
  })

  it('读数里的偏好会同步到本地状态（归一未知值为 auto）', async () => {
    transport(() => reading({ preference: 'credits' }))
    const store = await loadStore()
    await store.loadBadgeProvider('trae')
    expect(store.badgePreference).toBe('credits')

    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'usage.badge') return reading({ preference: '离谱值' })
      return { preference: 'auto' }
    })
    await store.loadBadgeProvider('trae')
    expect(store.badgePreference).toBe('auto')
  })

  it('设置偏好下发三种之一，非法值被插件拒绝后错误上报', async () => {
    transport(() => reading())
    const store = await loadStore()
    await store.loadBadgeProvider('trae')

    await store.setBadgePreference('subscription')
    const prefCalls = callJetHubMock.mock.calls.filter(([m]) => m === 'usage.badgePreference')
    expect(prefCalls).toContainEqual(['usage.badgePreference', { preference: 'subscription' }])
    // 偏好影响折叠态文案，必须立刻重读（且带 force 绕开宿主侧 TTL 缓存）
    expect(badgeCalls().some((p) => (p as { force?: boolean }).force === true)).toBe(true)

    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'usage.badge') return reading()
      if (method === 'usage.badgePreference') {
        throw Object.assign(new Error('preference 必须是 auto / subscription / credits 之一'), { code: 'bad-request' })
      }
      return {}
    })
    await expect(store.setBadgePreference('auto')).rejects.toThrow('preference 必须是')
    expect(store.error).toContain('preference 必须是')
    expect(store.pending).toBe('')
  })

  it('轮询：立即读一次，之后按间隔读；stop 之后不再读', async () => {
    vi.useFakeTimers()
    try {
      transport(() => reading())
      const store = await loadStore()

      const stop = store.startBadgePolling('trae', 1000)
      // 立即那次是异步的，先让微任务跑完
      await vi.advanceTimersByTimeAsync(0)
      expect(badgeCalls()).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(3000)
      expect(badgeCalls().length).toBe(4) // 1 + 三次间隔

      stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(badgeCalls()).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('页面隐藏时跳过这一轮轮询', async () => {
    vi.useFakeTimers()
    try {
      transport(() => reading())
      const store = await loadStore()
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)

      store.startBadgePolling('trae', 1000)
      await vi.advanceTimersByTimeAsync(0)
      const first = badgeCalls().length
      await vi.advanceTimersByTimeAsync(3000)
      expect(badgeCalls()).toHaveLength(first) // 隐藏期间一轮都没发

      hidden.mockReturnValue(false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(badgeCalls().length).toBeGreaterThan(first)

      store.stopBadgePolling()
      hidden.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})
