/**
 * Jet Hub 管理面 store（PLUGIN-001 / P4）。
 *
 * 锁三件事：
 *   1. 渠道清单来自 **Maxma 后端**（`/plugins/:name/providers`），不是前端硬编码 ——
 *      上游增删渠道时硬编码那份会静默过期；
 *   2. rail 的「已打开 / 已关闭」按插件回的 `closed` 分流，账号计数按渠道汇总；
 *   3. 插件还没起好（providers 为空）要走 `notReady` 提示，而不是当成错误或空数据。
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
  { id: 'trae', name: 'TRAE (字节)' },
  { id: 'buddy', name: 'CodeBuddy (腾讯)' },
  { id: 'zcode', name: 'ZCode (智谱)' },
]

const STATUSES = {
  trae: { models: { total: 9, disabled: 0 }, accounts: { total: 2, enabled: 1 }, closed: false },
  buddy: { models: { total: 16, disabled: 3 }, accounts: { total: 1, enabled: 1 }, closed: false },
  zcode: { models: { total: 4, disabled: 0 }, accounts: { total: 0, enabled: 0 }, closed: true },
}

function mockHappyPath() {
  requestMock.mockImplementation(async () => ({ providers: ROUTES }))
  callJetHubMock.mockImplementation(async (method: string) => {
    if (method === 'provider.status') return { statuses: STATUSES }
    if (method === 'account.list') {
      return {
        accounts: [
          { id: 'TRAE_ACCOUNT_1', provider: 'trae', nickname: '主号', enabled: true, expiresAt: Date.now() + 86_400_000 },
          { id: 'TRAE_ACCOUNT_2', provider: 'trae', enabled: false },
          { id: 'BUDDY_ACCOUNT_1', provider: 'buddy', refreshable: true },
        ],
      }
    }
    throw new Error(`unexpected method ${method}`)
  })
}

describe('jetHub store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestMock.mockReset()
    callJetHubMock.mockReset()
  })

  it('loads routes from Maxma, then statuses and accounts from the plugin RPC', async () => {
    mockHappyPath()
    const store = await loadStore()

    await store.refresh()

    expect(requestMock).toHaveBeenCalledWith('/plugins/codearts-auth/providers')
    // 状态查询必须带上后端给的渠道 id（插件要求 providers 是字符串数组）
    expect(callJetHubMock).toHaveBeenCalledWith('provider.status', { providers: ['trae', 'buddy', 'zcode'] })
    expect(callJetHubMock).toHaveBeenCalledWith('account.list', {})
    expect(store.routes).toHaveLength(3)
    expect(store.notReady).toBe('')
    expect(store.error).toBe('')
  })

  it('splits the rail by the plugin-reported closed flag and sums account counts', async () => {
    mockHappyPath()
    const store = await loadStore()
    await store.refresh()

    expect(store.openProviders.map((p) => p.id)).toEqual(['trae', 'buddy'])
    expect(store.closedProviders.map((p) => p.id)).toEqual(['zcode'])
    expect(store.accountTotal).toBe(3) // 2 + 1 + 0
    expect(store.accountEnabled).toBe(2) // 1 + 1 + 0
    expect(store.accountsOf('trae')).toHaveLength(2)
    expect(store.statusOf('zcode').models.total).toBe(4)
    // 未知渠道回落到空状态，而不是 undefined 崩在模板里
    expect(store.statusOf('nope').accounts.total).toBe(0)
  })

  it('reports notReady (not an error) while the plugin is still starting', async () => {
    requestMock.mockImplementation(async () => ({ providers: [], detail: '插件未就绪：宿主尚未装配' }))
    const store = await loadStore()

    await store.refresh()

    expect(store.routes).toEqual([])
    expect(store.notReady).toContain('插件未就绪')
    expect(store.error).toBe('')
    // 渠道为空时不该再去打 RPC
    expect(callJetHubMock).not.toHaveBeenCalled()
  })

  it('surfaces RPC failures as an error and rethrows', async () => {
    requestMock.mockImplementation(async () => ({ providers: ROUTES }))
    callJetHubMock.mockImplementation(async () => {
      throw Object.assign(new Error('未登录'), { code: 'jet-hub/handler-failed' })
    })
    const store = await loadStore()

    await expect(store.refresh()).rejects.toThrow('未登录')
    expect(store.error).toBe('未登录')
    expect(store.loading).toBe(false)
  })

  it('keeps the plugin name configurable for future plugins', async () => {
    mockHappyPath()
    const store = await loadStore()
    store.setPluginName('another-plugin')
    await store.refresh()
    expect(requestMock).toHaveBeenCalledWith('/plugins/another-plugin/providers')
  })
})

/**
 * 写操作的入参形状全部来自插件自身的校验文案（真机把 {} 喂进去读 bad-request），
 * 所以这里逐字锁 key —— 键名写错时插件只回一句中文校验错误，不会崩，
 * 界面上表现为「点了没反应」，是最难查的一类回归。
 */
describe('jetHub store 写操作', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestMock.mockReset()
    callJetHubMock.mockReset()
  })

  /** 只记录调用，不关心返回值。 */
  function recordCalls(overrides: Record<string, unknown> = {}) {
    requestMock.mockImplementation(async () => ({ providers: ROUTES }))
    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: STATUSES }
      if (method === 'account.list') return { accounts: [] }
      if (method === 'model.list') return { models: [] }
      if (method in overrides) return overrides[method]
      return {}
    })
  }

  function callsTo(method: string) {
    return callJetHubMock.mock.calls.filter(([m]) => m === method).map(([, payload]) => payload)
  }

  it('provider.setEnabled 传 { provider, enabled } 并重读状态', async () => {
    recordCalls()
    const store = await loadStore()
    await store.setProviderEnabled('trae', false)

    expect(callsTo('provider.setEnabled')).toEqual([{ provider: 'trae', enabled: false }])
    // 写后必须重读（插件侧会被后台任务改，不能本地乐观更新）
    expect(callsTo('provider.status').length).toBeGreaterThan(0)
    expect(store.pending).toBe('')
  })

  it('model.setDisabled 传 { provider, modelId, disabled } 并重读模型与状态', async () => {
    recordCalls()
    const store = await loadStore()
    await store.setModelDisabled('buddy', 'Doubao-Seed-2.1-Pro', true)

    expect(callsTo('model.setDisabled')).toEqual([
      { provider: 'buddy', modelId: 'Doubao-Seed-2.1-Pro', disabled: true },
    ])
    expect(callsTo('model.list')).toEqual([{ provider: 'buddy' }])
  })

  it('账号操作用 accountId 作为键', async () => {
    recordCalls()
    const store = await loadStore()
    await store.testAccount('TRAE_ACCOUNT_1')
    await store.refreshAccount('TRAE_ACCOUNT_1')
    await store.deleteAccount('TRAE_ACCOUNT_1')

    expect(callsTo('account.test')).toEqual([{ accountId: 'TRAE_ACCOUNT_1' }])
    expect(callsTo('account.refresh')).toEqual([{ accountId: 'TRAE_ACCOUNT_1' }])
    expect(callsTo('account.delete')).toEqual([{ accountId: 'TRAE_ACCOUNT_1' }])
  })

  it('重置限流走无参的 account.reset 并回执清理数量', async () => {
    recordCalls({ 'account.reset': { clearedCount: 3, accountCount: 5 } })
    const store = await loadStore()

    await expect(store.resetRateLimits()).resolves.toEqual({ clearedCount: 3, accountCount: 5 })
    expect(callsTo('account.reset')).toEqual([{}])
  })

  it('写失败时把插件错误文案放进 error，并清掉 pending', async () => {
    requestMock.mockImplementation(async () => ({ providers: ROUTES }))
    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: STATUSES }
      if (method === 'account.list') return { accounts: [] }
      throw Object.assign(new Error('provider 与非空布尔 enabled 必填'), { code: 'bad-request' })
    })
    const store = await loadStore()

    await expect(store.setProviderEnabled('trae', true)).rejects.toThrow('provider 与非空布尔 enabled 必填')
    expect(store.error).toBe('provider 与非空布尔 enabled 必填')
    expect(store.pending).toBe('')
  })
})
