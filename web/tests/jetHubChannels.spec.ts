/**
 * 渠道专属面板：Cline 订阅额度与请求日志、Loomy/Raccoon 新人任务（PLUGIN-001 / P9）。
 *
 * 这批方法的限制是插件端点**写死**的，界面必须照着做，否则用户会在不支持的渠道上
 * 看到按钮、点了才吃一个 `unsupported provider`：
 *   - `cline.quota` 只认 `provider: 'cline'`；
 *   - `cline.requestLog` 只认 cline，且 **accountId 必传**（面板用同一个账号切额度与日志）；
 *   - `onboarding.status` / `claim` **只支持 loomy 与 raccoon**，且必须带 accountId。
 *
 * 另外锁一条语义：请求日志是**插件自己发出的请求流水**（可含失败行），不是官方用量；
 * 失败行必须原样保留 —— 它是排查「为什么没回复」的第一线索。
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

const ROUTES = [
  { id: 'cline', name: 'Cline' },
  { id: 'loomy', name: 'Loomy' },
  { id: 'raccoon', name: 'Raccoon' },
]

function transport(overrides: Record<string, unknown> = {}) {
  requestMock.mockImplementation(async () => ({ providers: ROUTES }))
  callJetHubMock.mockImplementation(async (method: string) => {
    if (method === 'provider.status') return { statuses: {} }
    if (method === 'account.list') return { accounts: [] }
    if (method in overrides) return overrides[method]
    return {}
  })
}

function callsTo(method: string) {
  return callJetHubMock.mock.calls.filter(([m]) => m === method).map(([, payload]) => payload)
}

describe('渠道专属面板', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestMock.mockReset()
    callJetHubMock.mockReset()
  })

  it('cline.quota 固定带 provider:"cline"', async () => {
    transport({ 'cline.quota': { accounts: [{ accountId: 'cline-1', summary: '5 小时 6% · 本周 2%' }] } })
    const store = await loadStore()

    await store.loadClineQuota()

    expect(callsTo('cline.quota')).toEqual([{ provider: 'cline' }])
    expect(store.clineQuota?.accounts).toHaveLength(1)
    expect(store.clineQuotaLoading).toBe(false)
  })

  it('cline.requestLog 带 accountId 与 limit，并保留失败行', async () => {
    transport({
      'cline.requestLog': {
        rows: [
          { ts: 1, model: 'claude-x', status: 200, durationMs: 800 },
          { ts: 2, model: 'claude-x', error: 'HTTP 429' },
        ],
      },
    })
    const store = await loadStore()

    await store.loadClineRequestLog('cline-1', 50)

    expect(callsTo('cline.requestLog')).toEqual([{ provider: 'cline', accountId: 'cline-1', limit: 50 }])
    expect(store.clineRequestLogAccount).toBe('cline-1')
    // 失败行不能被过滤掉
    expect(store.clineRequestLog).toHaveLength(2)
    expect(store.clineRequestLog[1]?.error).toBe('HTTP 429')
  })

  it('不传 limit 时不带该字段（插件用默认值）', async () => {
    transport({ 'cline.requestLog': { rows: [] } })
    const store = await loadStore()

    await store.loadClineRequestLog('cline-1')
    expect(callsTo('cline.requestLog')).toEqual([{ provider: 'cline', accountId: 'cline-1' }])
  })

  it('请求日志读失败时清空并记 error', async () => {
    transport()
    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: {} }
      if (method === 'account.list') return { accounts: [] }
      throw Object.assign(new Error('accountId 不能为空'), { code: 'bad-request' })
    })
    const store = await loadStore()

    await store.loadClineRequestLog('')
    expect(store.clineRequestLog).toEqual([])
    expect(store.error).toBe('accountId 不能为空')
  })

  it('onboarding.status 带 provider 与 accountId，只在 loomy/raccoon 下发', async () => {
    transport({
      'onboarding.status': {
        tasks: [{ id: 't1', title: '首次对话', claimable: true, claimed: false, earned: 300 }],
        earned: 300,
      },
    })
    const store = await loadStore()

    await store.loadOnboarding('raccoon', 'raccoon-1')

    expect(callsTo('onboarding.status')).toEqual([{ provider: 'raccoon', accountId: 'raccoon-1' }])
    expect(store.onboarding?.tasks).toHaveLength(1)
    expect(store.onboarding?.earned).toBe(300)
  })

  it('onboarding.claim 领取后重读状态并刷新账号列表', async () => {
    let claimed = false
    requestMock.mockImplementation(async () => ({ providers: ROUTES }))
    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: {} }
      if (method === 'account.list') return { accounts: [] }
      if (method === 'onboarding.claim') {
        claimed = true
        // 幂等语义：已领过时 earned 仍报**累计值**，不是 0
        return { granted: !claimed, earned: 300, claimed: [], skipped: [] }
      }
      if (method === 'onboarding.status') {
        return { tasks: [{ id: 't1', title: '首次对话', claimed: true, earned: 300 }], earned: 300 }
      }
      return {}
    })
    const store = await loadStore()

    const res = (await store.claimOnboarding('loomy', 'loomy-1')) as { earned?: number }
    expect(callsTo('onboarding.claim')).toEqual([{ provider: 'loomy', accountId: 'loomy-1' }])
    expect(res.earned).toBe(300)
    // 领取后必须重读状态（任务从「可领取」变「已领取」）
    expect(callsTo('onboarding.status')).toEqual([{ provider: 'loomy', accountId: 'loomy-1' }])
    expect(store.onboarding?.tasks[0]?.claimed).toBe(true)
  })

  it('clearAccountDetail 同时清掉两类明细', async () => {
    transport({
      'cline.requestLog': { rows: [{ ts: 1 }] },
      'onboarding.status': { tasks: [{ id: 't' }] },
    })
    const store = await loadStore()

    await store.loadClineRequestLog('cline-1')
    await store.loadOnboarding('loomy', 'loomy-1')
    expect(store.clineRequestLog).toHaveLength(1)
    expect(store.onboarding).not.toBeNull()

    store.clearAccountDetail()
    expect(store.clineRequestLog).toEqual([])
    expect(store.clineRequestLogAccount).toBe('')
    expect(store.onboarding).toBeNull()
  })
})
