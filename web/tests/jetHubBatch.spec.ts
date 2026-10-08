/**
 * 批量 / 排序 / 账号更新（PLUGIN-001 / P8）。
 *
 * 这批方法都是「现有面板上的增强」，但入参形状错一样会静默失败（插件只回中文校验文案），
 * 所以逐字锁 payload。另外锁两条顺序语义：
 *   - `provider.setOrder` 的 `order` 是**渠道 id 的完整数组**（不是"把 A 移到 B 前"这类指令）；
 *   - `account.reorder` 的 `order` 同理，且必须带 `provider`。
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
  { id: 'trae', name: 'TRAE' },
  { id: 'buddy', name: 'CodeBuddy' },
  { id: 'cline', name: 'Cline' },
]

function transport(overrides: Record<string, unknown> = {}) {
  requestMock.mockImplementation(async () => ({ providers: ROUTES }))
  callJetHubMock.mockImplementation(async (method: string) => {
    if (method === 'provider.status') return { statuses: {} }
    if (method === 'account.list') return { accounts: [] }
    if (method === 'model.list') return { models: [] }
    if (method in overrides) return overrides[method]
    return {}
  })
}

function callsTo(method: string) {
  return callJetHubMock.mock.calls.filter(([m]) => m === method).map(([, payload]) => payload)
}

describe('批量操作与排序', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestMock.mockReset()
    callJetHubMock.mockReset()
  })

  it('重测：单个用 accountId，全部无参', async () => {
    transport({ 'account.retestAll': { accounts: [], clearedCount: 2 } })
    const store = await loadStore()

    await store.retestAccount('TRAE_ACCOUNT_1')
    expect(callsTo('account.retest')).toEqual([{ accountId: 'TRAE_ACCOUNT_1' }])

    const res = await store.retestAllAccounts()
    expect(callsTo('account.retestAll')).toEqual([{}])
    expect(res).toMatchObject({ clearedCount: 2 })
  })

  it('全部重置限流走无参 account.resetAll，并回执清理数量', async () => {
    transport({ 'account.resetAll': { clearedCount: 7, accountCount: 9 } })
    const store = await loadStore()

    await expect(store.resetAllRateLimits()).resolves.toEqual({ clearedCount: 7, accountCount: 9 })
    expect(callsTo('account.resetAll')).toEqual([{}])
  })

  it('账号更新把 patch 单独包一层（插件的签名是 {accountId, patch}）', async () => {
    transport()
    const store = await loadStore()

    await store.updateAccount('TRAE_ACCOUNT_1', { enabled: false })
    await store.updateAccount('TRAE_ACCOUNT_1', { nickname: '主号' })

    expect(callsTo('account.update')).toEqual([
      { accountId: 'TRAE_ACCOUNT_1', patch: { enabled: false } },
      { accountId: 'TRAE_ACCOUNT_1', patch: { nickname: '主号' } },
    ])
  })

  it('账号排序带 provider 与完整 id 数组', async () => {
    transport()
    const store = await loadStore()

    await store.reorderAccounts('trae', ['b', 'a'])
    expect(callsTo('account.reorder')).toEqual([{ provider: 'trae', order: ['b', 'a'] }])
  })

  it('模型批量：单模型 / 全部 / 清理失效各自的入参', async () => {
    transport()
    const store = await loadStore()

    await store.setModelsDisabled('trae', ['m1', 'm2'], true)
    expect(callsTo('model.setDisabledMany')).toEqual([{ provider: 'trae', modelIds: ['m1', 'm2'], disabled: true }])

    await store.setAllModelsDisabled('trae', false)
    expect(callsTo('model.setAllDisabled')).toEqual([{ provider: 'trae', disabled: false }])

    await store.clearDeadModels('trae')
    expect(callsTo('model.clearDead')).toEqual([{ provider: 'trae' }])

    // 三者都要重读模型列表与渠道状态（界面上数字要跟着变）
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'model.list').length).toBeGreaterThanOrEqual(3)
  })

  it('渠道顺序：读回 {order}，保存下发完整数组', async () => {
    transport({ 'provider.getOrder': { order: ['trae', 'buddy', 'cline'] } })
    const store = await loadStore()

    await store.loadProviderOrder()
    expect(callsTo('provider.getOrder')).toEqual([{}])
    expect(store.providerOrder).toEqual(['trae', 'buddy', 'cline'])

    await store.saveProviderOrder(['buddy', 'trae', 'cline'])
    expect(callsTo('provider.setOrder')).toEqual([{ order: ['buddy', 'trae', 'cline'] }])
  })

  it('上移/下移渠道按当前 rail 顺序重算完整数组，边界不动', async () => {
    transport()
    const store = await loadStore()
    await store.refresh()
    expect(store.routes.map((r) => r.id)).toEqual(['trae', 'buddy', 'cline'])

    await store.moveProvider('buddy', -1)
    expect(callsTo('provider.setOrder')).toEqual([{ order: ['buddy', 'trae', 'cline'] }])

    // 首位再上移是无操作（不产生多余写请求）
    await store.moveProvider('trae', -1)
    expect(callsTo('provider.setOrder')).toHaveLength(1)

    await store.moveProvider('cline', 1)
    expect(callsTo('provider.setOrder')).toHaveLength(1)
  })

  it('自动签到：读回状态，写下发布尔', async () => {
    transport({
      'usage.autoCheckin': { autoCheckin: { enabled: false, lastDate: '2026-10-07', ranToday: false } },
    })
    const store = await loadStore()

    await store.loadAutoCheckin()
    expect(callsTo('usage.autoCheckin')).toEqual([{}])
    expect(store.autoCheckin?.lastDate).toBe('2026-10-07')

    await store.setAutoCheckin(true)
    expect(callsTo('usage.autoCheckin')[1]).toEqual({ enabled: true })
  })

  it('写失败时上报插件原文并清 pending', async () => {
    transport()
    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: {} }
      if (method === 'account.list') return { accounts: [] }
      throw Object.assign(new Error('provider 必填'), { code: 'bad-request' })
    })
    const store = await loadStore()

    await expect(store.reorderAccounts('', ['a'])).rejects.toThrow('provider 必填')
    expect(store.error).toBe('provider 必填')
    expect(store.pending).toBe('')
  })
})
